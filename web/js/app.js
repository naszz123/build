/**
 * Web2APK Dashboard - JavaScript App
 */

// State
// let selectedColor = '#2196F3'; // Removed
let selectedIcon = null;
let expireCountdown = null;

// ZIP Build State
let selectedProjectType = 'flutter';
let selectedBuildType = 'release';
let selectedZipFile = null;
let zipExpireCountdown = null;

// Session ID - unique per browser tab for per-session logs
const sessionId = (function () {
    // Try to get from sessionStorage first
    let id = sessionStorage.getItem('buildSessionId');
    if (!id) {
        // Generate new session ID
        id = 'sess-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
        sessionStorage.setItem('buildSessionId', id);
    }
    return id;
})();
console.log('[Session] ID:', sessionId);

// ==================== ANTI-CLONE PROTECTION ====================
(function () {
    const EXPECTED_PATHS = ['/api/', '/login.html', '/index.html', '/'];
    const serverFP = document.querySelector('meta[name="server-fp"]')?.content;

    // Validate server response
    async function validateServer() {
        try {
            const response = await fetch('/api/specs', { method: 'GET' });
            const fp = response.headers.get('X-Server-FP');

            if (!fp) {
                console.warn('[Security] Server fingerprint missing');
                return false;
            }

            // Store fingerprint for API calls
            window._serverFP = fp;
            return true;
        } catch (e) {
            console.error('[Security] Validation failed:', e);
            return false;
        }
    }

    // Run validation on page load
    validateServer().then(valid => {
        if (!valid) {
            console.warn('[Security] Running in unverified mode');
        }
    });

    // Add fingerprint to all fetch requests
    const originalFetch = window.fetch;
    window.fetch = function (url, options = {}) {
        if (window._serverFP && typeof url === 'string' && url.startsWith('/api/')) {
            options.headers = {
                ...options.headers,
                'X-Client-FP': window._serverFP
            };
        }
        return originalFetch.call(this, url, options);
    };
})();

// ==================== BUILD STATE PERSISTENCE ====================

/**
 * Save build state to localStorage
 * This allows users to close browser and return to see their build status
 */
function saveBuildState(type, state) {
    const key = `web2apk_build_${type}`;
    const data = {
        ...state,
        savedAt: Date.now(),
        sessionId: sessionId
    };
    localStorage.setItem(key, JSON.stringify(data));
    console.log(`[BuildState] Saved ${type}:`, state.status);
}

/**
 * Get saved build state from localStorage
 */
function getBuildState(type) {
    const key = `web2apk_build_${type}`;
    const data = localStorage.getItem(key);
    if (!data) return null;

    try {
        const state = JSON.parse(data);
        // Expire state after 5 minutes (in case build was interrupted)
        const maxAge = 5 * 60 * 1000;
        if (Date.now() - state.savedAt > maxAge && state.status !== 'result') {
            localStorage.removeItem(key);
            return null;
        }
        return state;
    } catch (e) {
        localStorage.removeItem(key);
        return null;
    }
}

/**
 * Clear build state
 */
function clearBuildState(type) {
    const key = `web2apk_build_${type}`;
    localStorage.removeItem(key);
    console.log(`[BuildState] Cleared ${type}`);
}

/**
 * Save logs to localStorage
 */
function saveLogsToLocal(logs) {
    const key = `web2apk_logs_${sessionId}`;
    localStorage.setItem(key, JSON.stringify({
        logs: logs.slice(0, 50), // Keep last 50 logs
        savedAt: Date.now()
    }));
}

/**
 * Get logs from localStorage
 */
function getLogsFromLocal() {
    const key = `web2apk_logs_${sessionId}`;
    const data = localStorage.getItem(key);
    if (!data) return [];

    try {
        const parsed = JSON.parse(data);
        // Expire logs after 10 minutes
        if (Date.now() - parsed.savedAt > 10 * 60 * 1000) {
            localStorage.removeItem(key);
            return [];
        }
        return parsed.logs || [];
    } catch (e) {
        return [];
    }
}

/**
 * Clear local logs
 */
function clearLocalLogs() {
    const key = `web2apk_logs_${sessionId}`;
    localStorage.removeItem(key);
}

// ==================== AUTH SESSION MANAGEMENT ====================

/**
 * Get stored session from localStorage
 */
function getAuthSession() {
    const sessionData = localStorage.getItem('web2apk_session');
    if (!sessionData) return null;

    try {
        const session = JSON.parse(sessionData);
        // Check if expired
        if (new Date(session.expiresAt) <= new Date()) {
            localStorage.removeItem('web2apk_session');
            return null;
        }
        return session;
    } catch (e) {
        localStorage.removeItem('web2apk_session');
        return null;
    }
}

/**
 * Get Authorization header for API calls
 */
function getAuthHeader() {
    const session = getAuthSession();
    if (!session) return {};
    return {
        'Authorization': `Bearer ${session.username}:${session.deviceId}`
    };
}

/**
 * Check if user is logged in, redirect to login if not
 */
async function checkAuthRequired() {
    const session = getAuthSession();

    if (!session) {
        console.log('[Auth] No session, redirecting to login');
        window.location.href = 'login.html';
        return false;
    }

    // Verify session with server
    try {
        const response = await fetch(`/api/auth/verify?username=${encodeURIComponent(session.username)}&deviceId=${encodeURIComponent(session.deviceId)}`);
        const data = await response.json();

        if (!data.valid) {
            console.log('[Auth] Session invalid:', data.reason);
            localStorage.removeItem('web2apk_session');
            window.location.href = 'login.html';
            return false;
        }

        console.log('[Auth] Session valid for:', session.username);
        return true;
    } catch (e) {
        console.error('[Auth] Verify error:', e);
        // Allow offline access if can't reach server
        return true;
    }
}

/**
 * Logout and redirect to login page
 */
async function logout() {
    const session = getAuthSession();

    if (session) {
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: session.username,
                    deviceId: session.deviceId
                })
            });
        } catch (e) {
            console.error('[Auth] Logout error:', e);
        }
    }

    localStorage.removeItem('web2apk_session');
    window.location.href = 'login.html';
}

// Check auth immediately when page loads
checkAuthRequired().then(isValid => {
    if (isValid) {
        // Show username in header
        const session = getAuthSession();
        if (session) {
            const userDisplay = document.getElementById('userDisplay');
            const loggedInUser = document.getElementById('loggedInUser');
            if (userDisplay && loggedInUser) {
                loggedInUser.textContent = session.username;
                userDisplay.style.display = 'inline-flex';
                userDisplay.style.alignItems = 'center';
                userDisplay.style.gap = '6px';
                userDisplay.style.padding = '6px 12px';
                userDisplay.style.background = 'rgba(99, 102, 241, 0.1)';
                userDisplay.style.borderRadius = '8px';
                userDisplay.style.marginRight = '8px';
            }
        }
    }
});


// ==================== WEBVIEW COMPATIBILITY HELPERS ====================

/**
 * WebView-safe function to toggle element visibility
 * CSS .hidden uses !important, so we must remove class BEFORE setting inline styles
 */
function setElementVisible(element, visible) {
    if (!element) {
        console.warn('[setElementVisible] Element is null');
        return;
    }

    if (visible) {
        // CRITICAL: Remove hidden class FIRST (before setting display)
        element.classList.remove('hidden');
        // Use !important to override any CSS rules
        element.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important;';
        // Force repaint for WebView
        forceRepaint(element);
        console.log('[setElementVisible] Made visible:', element.id || element.className);
    } else {
        element.style.cssText = '';
        element.classList.add('hidden');
        console.log('[setElementVisible] Made hidden:', element.id || element.className);
    }
}

/**
 * Force browser/WebView to repaint an element
 * Uses multiple techniques for maximum compatibility
 */
function forceRepaint(element) {
    if (!element) return;

    // Technique 1: Read offsetHeight to trigger reflow
    void element.offsetHeight;

    // Technique 2: GPU layer promotion
    element.style.transform = 'translateZ(0)';
    void element.offsetWidth;
    element.style.transform = '';

    // Technique 3: Use requestAnimationFrame for next paint cycle
    requestAnimationFrame(() => {
        void element.offsetHeight;
    });
}

/**
 * Verify element is actually visible in DOM
 * Returns true if element is displayed
 */
function isElementVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

// DOM Elements
const elements = {
    // Stats
    serverStatus: document.getElementById('serverStatus'),
    totalUsers: document.getElementById('totalUsers'),
    uptime: document.getElementById('uptime'),
    queueStatus: document.getElementById('queueStatus'),
    activeSessions: document.getElementById('activeSessions'),

    // Specs
    osInfo: document.getElementById('osInfo'),
    cpuInfo: document.getElementById('cpuInfo'),
    memInfo: document.getElementById('memInfo'),
    memoryBar: document.getElementById('memoryBar'),
    memoryText: document.getElementById('memoryText'),
    nodeInfo: document.getElementById('nodeInfo'),

    // Form
    buildForm: document.getElementById('buildForm'),
    urlInput: document.getElementById('urlInput'),
    appNameInput: document.getElementById('appNameInput'),
    buildBtn: document.getElementById('buildBtn'),

    // Icon upload
    iconUploadZone: document.getElementById('iconUploadZone'),
    iconInput: document.getElementById('iconInput'),
    uploadPlaceholder: document.getElementById('uploadPlaceholder'),
    uploadPreview: document.getElementById('uploadPreview'),
    iconPreviewImg: document.getElementById('iconPreviewImg'),
    removeIconBtn: document.getElementById('removeIconBtn'),

    // Progress
    buildProgress: document.getElementById('buildProgress'),
    progressText: document.getElementById('progressText'),
    progressFill: document.getElementById('progressFill'),

    // Result
    buildResult: document.getElementById('buildResult'),
    downloadBtn: document.getElementById('downloadBtn'),
    expireTime: document.getElementById('expireTime'),

    // Error
    buildError: document.getElementById('buildError'),
    errorMessage: document.getElementById('errorMessage'),
    retryBtn: document.getElementById('retryBtn'),

    // ZIP Build Form
    zipBuildForm: document.getElementById('zipBuildForm'),
    zipUploadZone: document.getElementById('zipUploadZone'),
    zipInput: document.getElementById('zipInput'),
    zipPlaceholder: document.getElementById('zipPlaceholder'),
    zipPreview: document.getElementById('zipPreview'),
    zipFileName: document.getElementById('zipFileName'),
    removeZipBtn: document.getElementById('removeZipBtn'),
    zipBuildBtn: document.getElementById('zipBuildBtn'),

    // ZIP Build Progress/Result/Error
    zipBuildProgress: document.getElementById('zipBuildProgress'),
    zipProgressText: document.getElementById('zipProgressText'),
    zipProgressFill: document.getElementById('zipProgressFill'),
    zipBuildResult: document.getElementById('zipBuildResult'),
    zipDownloadBtn: document.getElementById('zipDownloadBtn'),
    zipExpireTime: document.getElementById('zipExpireTime'),
    zipBuildError: document.getElementById('zipBuildError'),
    zipErrorMessage: document.getElementById('zipErrorMessage'),
    zipRetryBtn: document.getElementById('zipRetryBtn'),

    // Actions
    refreshBtn: document.getElementById('refreshBtn')
};

// Build card elements
const urlBuildCard = document.getElementById('urlBuildCard');
const zipBuildCard = document.getElementById('zipBuildCard');

// Logs elements
const logsCard = document.querySelector('.logs-card');
const logsToggle = document.getElementById('logsToggle');
const logsContainer = document.getElementById('logsContainer');
const logsRefreshBtn = document.getElementById('logsRefreshBtn');
const logsClearBtn = document.getElementById('logsClearBtn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    loadSpecs();
    // setupColorPicker(); // Removed
    setupIconUpload();
    setupForm();
    setupRefresh();
    setupTabs();

    // ZIP Build setup
    setupProjectTypePicker();
    setupBuildTypePicker();
    setupZipUpload();
    setupZipForm();

    // Logs setup
    setupLogs();
    loadLogs();

    // Restore any saved build state (for browser close/refresh recovery)
    restoreBuildState();

    // Auto-refresh stats every 10 seconds
    setInterval(loadStats, 10000);
});

/**
 * Restore build state from localStorage on page load
 * This allows users to close browser and return to see their build results
 */
function restoreBuildState() {
    // Restore URL build state
    const urlState = getBuildState('url');
    if (urlState) {
        console.log('[RestoreState] Found URL build state:', urlState.status);

        if (urlState.status === 'result' && urlState.downloadUrl) {
            // Calculate remaining time
            const elapsedSeconds = Math.floor((Date.now() - urlState.savedAt) / 1000);
            const remainingTime = Math.max(0, (urlState.expiresIn || 120) - elapsedSeconds);

            if (remainingTime > 0) {
                showResult(urlState.downloadUrl, remainingTime);
            } else {
                // Expired, clear state
                clearBuildState('url');
            }
        } else if (urlState.status === 'progress') {
            // Build was in progress - show message that it may have been interrupted
            showError('Build sebelumnya terinterupsi. Silakan mulai build baru.');
            clearBuildState('url');
        }
    }

    // Restore ZIP build state
    const zipState = getBuildState('zip');
    if (zipState) {
        console.log('[RestoreState] Found ZIP build state:', zipState.status);

        // Switch to ZIP tab if there's a ZIP build state
        const zipTabBtn = document.querySelector('.tab-btn[data-tab="zip"]');
        if (zipTabBtn) {
            zipTabBtn.click();
        }

        if (zipState.status === 'result' && zipState.downloadUrl) {
            // Calculate remaining time
            const elapsedSeconds = Math.floor((Date.now() - zipState.savedAt) / 1000);
            const remainingTime = Math.max(0, (zipState.expiresIn || 120) - elapsedSeconds);

            if (remainingTime > 0) {
                showZipResult(zipState.downloadUrl, remainingTime);
            } else {
                // Expired, clear state
                clearBuildState('zip');
            }
        } else if (zipState.status === 'progress') {
            // Build was in progress - show message
            showZipError('Build sebelumnya terinterupsi. Silakan mulai build baru.');
            clearBuildState('zip');
        }
    }
}

// Setup build mode tabs
function setupTabs() {
    const tabBtns = document.querySelectorAll('.build-tabs .tab-btn');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const tab = btn.dataset.tab;

            if (tab === 'url') {
                urlBuildCard.classList.remove('hidden');
                zipBuildCard.classList.add('hidden');
            } else {
                urlBuildCard.classList.add('hidden');
                zipBuildCard.classList.remove('hidden');
            }
        });
    });
}

// Load server stats
async function loadStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();

        elements.totalUsers.textContent = data.totalUsers;
        elements.activeSessions.textContent = data.activeSessions;
        elements.uptime.textContent = formatUptime(data.uptime);

        // Queue status
        const isBusy = data.queueStatus === 'busy';
        elements.queueStatus.textContent = isBusy ? 'Busy' : 'Ready';
        elements.serverStatus.className = `status-badge ${isBusy ? 'busy' : ''}`;
        elements.serverStatus.querySelector('span:last-child').textContent =
            isBusy ? 'Building...' : 'Online';

    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

// Load server specs
async function loadSpecs() {
    try {
        const response = await fetch('/api/specs');
        const data = await response.json();

        // OS Info
        const osName = getOSName(data.os.platform);
        elements.osInfo.textContent = `${osName} (${data.os.arch})`;

        // CPU Info
        const cpuModel = data.cpu.model.split('@')[0].trim();
        elements.cpuInfo.textContent = `${cpuModel} • ${data.cpu.cores} Cores`;

        // Memory Info
        elements.memInfo.textContent = `${data.memory.used} GB / ${data.memory.total} GB`;

        const memPercent = Math.round((data.memory.used / data.memory.total) * 100);
        elements.memoryBar.style.width = `${memPercent}%`;
        elements.memoryText.textContent = `${memPercent}% used`;

        // Node Info
        elements.nodeInfo.textContent = data.node;

    } catch (error) {
        console.error('Failed to load specs:', error);
    }
}

// Format uptime
function formatUptime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

// Get OS name from platform
function getOSName(platform) {
    const names = {
        'win32': 'Windows',
        'darwin': 'macOS',
        'linux': 'Linux (VPS)'
    };
    return names[platform] || platform;
}

// Setup color picker removed

// Setup icon upload
function setupIconUpload() {
    const zone = elements.iconUploadZone;
    const input = elements.iconInput;

    // Click to upload
    zone.addEventListener('click', () => {
        if (!selectedIcon) {
            input.click();
        }
    });

    // File selected
    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            handleIconFile(file);
        }
    });

    // Drag and drop
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => {
        zone.classList.remove('dragover');
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            handleIconFile(file);
        }
    });

    // Remove button
    elements.removeIconBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeIcon();
    });
}

// Handle icon file
function handleIconFil
