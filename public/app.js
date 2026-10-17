document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const scanForm = document.getElementById('scanForm');
  const profileInput = document.getElementById('profileInput');
  const clearInputBtn = document.getElementById('clearInputBtn');
  const startScanBtn = document.getElementById('startScanBtn');
  const stopScanBtn = document.getElementById('stopScanBtn');
  const scanBtnText = document.getElementById('scanBtnText');
  const scanBtnIcon = document.getElementById('scanBtnIcon');

  // Progress & Console
  const progressSection = document.getElementById('progressSection');
  const statusHeading = document.getElementById('statusHeading');
  const statusSubtitle = document.getElementById('statusSubtitle');
  const statusSpinner = document.getElementById('statusSpinner');
  const mediaCounterBadge = document.getElementById('mediaCounterBadge');
  const consoleBody = document.getElementById('consoleBody');
  const toggleScrollBtn = document.getElementById('toggleScrollBtn');
  const clearConsoleBtn = document.getElementById('clearConsoleBtn');

  // Stepper Elements
  const stepInit = document.getElementById('step-init');
  const stepProfile = document.getElementById('step-profile');
  const stepFeed = document.getElementById('step-feed');
  const stepHighlights = document.getElementById('step-highlights');
  const stepReels = document.getElementById('step-reels');
  const line1 = document.getElementById('line-1');
  const line2 = document.getElementById('line-2');
  const line3 = document.getElementById('line-3');
  const line4 = document.getElementById('line-4');

  // Profile Section
  const profileSection = document.getElementById('profileSection');
  const profileAvatar = document.getElementById('profileAvatar');
  const profileUsername = document.getElementById('profileUsername');
  const profileFullName = document.getElementById('profileFullName');
  const profileBio = document.getElementById('profileBio');
  const verifiedBadge = document.getElementById('verifiedBadge');
  const privateBadge = document.getElementById('privateBadge');
  const statPostsCount = document.getElementById('statPostsCount');
  const statFollowersCount = document.getElementById('statFollowersCount');
  const statExtractedCount = document.getElementById('statExtractedCount');

  // Gallery Section
  const gallerySection = document.getElementById('gallerySection');
  const mediaGrid = document.getElementById('mediaGrid');
  const noResultsNotice = document.getElementById('noResultsNotice');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const countAll = document.getElementById('countAll');
  const countImages = document.getElementById('countImages');
  const countVideos = document.getElementById('countVideos');
  const countCarousels = document.getElementById('countCarousels');
  const countHighlights = document.getElementById('countHighlights');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const downloadSelectedBtn = document.getElementById('downloadSelectedBtn');
  const downloadAllZipBtn = document.getElementById('downloadAllZipBtn');
  const selectedCount = document.getElementById('selectedCount');

  // Modals
  const giveCookiesBtn = document.getElementById('giveCookiesBtn');
  const cookieStatusDot = document.getElementById('cookieStatusDot');
  const cookieModal = document.getElementById('cookieModal');
  const closeCookieModalBtn = document.getElementById('closeCookieModalBtn');
  const modalStatusDot = document.getElementById('modalStatusDot');
  const modalStatusTitle = document.getElementById('modalStatusTitle');
  const modalStatusDesc = document.getElementById('modalStatusDesc');
  const tabPaste = document.getElementById('tabPaste');
  const tabUpload = document.getElementById('tabUpload');
  const panelPaste = document.getElementById('panelPaste');
  const panelUpload = document.getElementById('panelUpload');
  const cookieTextarea = document.getElementById('cookieTextarea');
  const fileDropzone = document.getElementById('fileDropzone');
  const cookieFileInput = document.getElementById('cookieFileInput');
  const selectedFileLabel = document.getElementById('selectedFileLabel');
  const saveCookiesBtn = document.getElementById('saveCookiesBtn');
  const clearCookiesBtn = document.getElementById('clearCookiesBtn');

  const infoBtn = document.getElementById('infoBtn');
  const infoModal = document.getElementById('infoModal');
  const closeInfoModalBtn = document.getElementById('closeInfoModalBtn');

  // Lightbox
  const lightboxModal = document.getElementById('lightboxModal');
  const closeLightboxBtn = document.getElementById('closeLightboxBtn');
  const lightboxMediaContainer = document.getElementById('lightboxMediaContainer');
  const lightboxCategory = document.getElementById('lightboxCategory');
  const lightboxResolution = document.getElementById('lightboxResolution');
  const lightboxCaption = document.getElementById('lightboxCaption');
  const lightboxIgLink = document.getElementById('lightboxIgLink');
  const lightboxDownloadBtn = document.getElementById('lightboxDownloadBtn');

  // State
  let currentSessionId = null;
  let eventSource = null;
  let autoScroll = true;
  let allMediaItems = [];
  let currentFilter = 'all';
  let selectedMediaIds = new Set();
  let currentProfileData = null;

  // --- Cookie Management & Initialization ---
  async function refreshCookieStatus() {
    try {
      const res = await fetch('/api/cookies');
      const data = await res.json();
      updateCookieUI(data);
    } catch (e) {
      console.warn('Could not fetch cookie status:', e);
    }
  }

  function updateCookieUI(status) {
    cookieStatusDot.className = 'cookie-dot';
    modalStatusDot.className = 'status-dot';

    if (status.hasCookies && status.hasSession) {
      cookieStatusDot.classList.add('active');
      modalStatusDot.classList.add('active');
      cookieStatusDot.title = `Cookies Active (${status.count} loaded from ${status.source})`;
      modalStatusTitle.textContent = `Active Session (${status.count} Cookies Loaded)`;
      modalStatusDesc.textContent = status.userId 
        ? `Authenticated with Instagram (User ID: ${status.userId}) via ${status.source}`
        : `Authenticated session ready via ${status.source}`;
    } else if (status.hasCookies) {
      cookieStatusDot.classList.add('warning');
      modalStatusDot.classList.add('warning');
      cookieStatusDot.title = 'Cookies loaded but sessionid missing';
      modalStatusTitle.textContent = `Cookies Found (${status.count}), but sessionid missing`;
      modalStatusDesc.textContent = 'Please re-export fresh cookies from an active Instagram login.';
    } else {
      cookieStatusDot.classList.add('error');
      modalStatusDot.classList.add('error');
      cookieStatusDot.title = 'No cookies loaded (Guest Mode)';
      modalStatusTitle.textContent = 'No Cookies Configured (Guest Mode)';
      modalStatusDesc.textContent = 'Private profiles and full reels/highlights require authentication cookies.';
    }
  }

  refreshCookieStatus();

  // Give Cookies Modal Listeners
  giveCookiesBtn.addEventListener('click', () => {
    cookieModal.classList.remove('hidden');
    refreshCookieStatus();
  });

  closeCookieModalBtn.addEventListener('click', () => {
    cookieModal.classList.add('hidden');
  });

  // Info Modal Listeners
  infoBtn.addEventListener('click', () => {
    infoModal.classList.remove('hidden');
  });

  closeInfoModalBtn.addEventListener('click', () => {
    infoModal.classList.add('hidden');
  });

  // Modal tab switching
  tabPaste.addEventListener('click', () => {
    tabPaste.classList.add('active');
    tabUpload.classList.remove('active');
    panelPaste.classList.add('active');
    panelUpload.classList.remove('active');
  });

  tabUpload.addEventListener('click', () => {
    tabUpload.classList.add('active');
    tabPaste.classList.remove('active');
    panelUpload.classList.add('active');
    panelPaste.classList.remove('active');
  });

  // File dropzone
  fileDropzone.addEventListener('click', () => cookieFileInput.click());
  fileDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileDropzone.classList.add('dragover');
  });
  fileDropzone.addEventListener('dragleave', () => fileDropzone.classList.remove('dragover'));
  fileDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    fileDropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleCookieFile(e.dataTransfer.files[0]);
    }
  });

  cookieFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleCookieFile(e.target.files[0]);
    }
  });

  function handleCookieFile(file) {
    selectedFileLabel.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    const reader = new FileReader();
    reader.onload = (e) => {
      cookieTextarea.value = e.target.result;
    };
    reader.readAsText(file);
  }

  // Save cookies
  saveCookiesBtn.addEventListener('click', async () => {
    const raw = cookieTextarea.value.trim();
    if (!raw) {
      alert('Please paste cookie data or upload a cookies.json file first.');
      return;
    }

    saveCookiesBtn.disabled = true;
    saveCookiesBtn.textContent = 'Saving...';

    try {
      const res = await fetch('/api/cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: raw })
      });
      const data = await res.json();

      if (data.error) {
        alert(`Error saving cookies: ${data.error}`);
      } else {
        updateCookieUI(data.status);
        alert(data.message || 'Cookies saved successfully!');
        cookieModal.classList.add('hidden');
      }
    } catch (err) {
      alert(`Network error: ${err.message}`);
    } finally {
      saveCookiesBtn.disabled = false;
      saveCookiesBtn.textContent = 'Save & Apply Cookies';
    }
  });

  // Clear cookies
  clearCookiesBtn.addEventListener('click', () => {
    if (confirm('Clear current cookie input?')) {
      cookieTextarea.value = '';
      selectedFileLabel.textContent = '';
      cookieFileInput.value = '';
    }
  });

  // Close modals on clicking backdrop
  window.addEventListener('click', (e) => {
    if (e.target === cookieModal) cookieModal.classList.add('hidden');
    if (e.target === infoModal) infoModal.classList.add('hidden');
    if (e.target === lightboxModal) lightboxModal.classList.add('hidden');
  });

  // --- Input & Search Bar Controls ---
  profileInput.addEventListener('input', () => {
    clearInputBtn.style.display = profileInput.value ? 'block' : 'none';
  });

  clearInputBtn.addEventListener('click', () => {
    profileInput.value = '';
    clearInputBtn.style.display = 'none';
    profileInput.focus();
  });

  // Quick example pills
  document.querySelectorAll('.example-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      profileInput.value = btn.getAttribute('data-profile');
      clearInputBtn.style.display = 'block';
      startScan();
    });
  });

  // Form submit
  scanForm.addEventListener('submit', (e) => {
    e.preventDefault();
    startScan();
  });

  // Stop scan button
  stopScanBtn.addEventListener('click', async () => {
    if (currentSessionId) {
      addConsoleLine('⏹️ Stop requested. Terminating browser and closing session...', 'warn');
      try {
        await fetch('/api/scan/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: currentSessionId })
        });
      } catch (e) {}
    }
    finishScanUI(false, 'Scan stopped by user.');
  });

  // Console controls
  toggleScrollBtn.addEventListener('click', () => {
    autoScroll = !autoScroll;
    toggleScrollBtn.textContent = `Auto-Scroll: ${autoScroll ? 'ON' : 'OFF'}`;
  });

  clearConsoleBtn.addEventListener('click', () => {
    consoleBody.innerHTML = '';
  });

  function addConsoleLine(text, type = 'normal') {
    const line = document.createElement('div');
    line.className = `console-line ${type}`;
    line.textContent = `> ${text}`;
    consoleBody.appendChild(line);
    if (autoScroll) {
      consoleBody.scrollTop = consoleBody.scrollHeight;
    }
  }

  // Stepper updates
  function setStepperStage(stage) {
    if (stage === 'init' || stage === 'browser') {
      stepInit.className = 'step-item active';
      line1.className = 'step-line';
      stepProfile.className = 'step-item';
      line2.className = 'step-line';
      stepFeed.className = 'step-item';
      line3.className = 'step-line';
      stepHighlights.className = 'step-item';
      line4.className = 'step-line';
      stepReels.className = 'step-item';
    } else if (stage === 'navigation' || stage === 'auth_success' || stage === 'guest_mode') {
      stepInit.className = 'step-item done';
      line1.className = 'step-line done';
      stepProfile.className = 'step-item active';
    } else if (stage === 'scrolling' || stage === 'feed_scan') {
      stepInit.className = 'step-item done';
      line1.className = 'step-line done';
      stepProfile.className = 'step-item done';
      line2.className = 'step-line done';
      stepFeed.className = 'step-item active';
    } else if (stage === 'highlights') {
      stepFeed.className = 'step-item done';
      line3.className = 'step-line done';
      stepHighlights.className = 'step-item active';
    } else if (stage === 'reels_tab' || stage === 'unpacking') {
      stepHighlights.className = 'step-item done';
      line4.className = 'step-line done';
      stepReels.className = 'step-item active';
    } else if (stage === 'complete') {
      stepInit.className = 'step-item done';
      line1.className = 'step-line done';
      stepProfile.className = 'step-item done';
      line2.className = 'step-line done';
      stepFeed.className = 'step-item done';
      line3.className = 'step-line done';
      stepHighlights.className = 'step-item done';
      line4.className = 'step-line done';
      stepReels.className = 'step-item done';
    }
  }

  // --- Main Start Scan Function ---
  async function startScan() {
    const input = profileInput.value.trim();
    if (!input) return;

    // Reset UI state
    currentSessionId = `ig_session_${Date.now()}`;
    allMediaItems = [];
    selectedMediaIds.clear();
    currentProfileData = null;
    mediaGrid.innerHTML = '';
    consoleBody.innerHTML = '';

    startScanBtn.style.display = 'none';
    stopScanBtn.style.display = 'inline-flex';
    progressSection.classList.remove('hidden');
    profileSection.classList.add('hidden');
    gallerySection.classList.add('hidden');
    statusSpinner.style.display = 'block';

    statusHeading.textContent = 'Starting Profile Extraction...';
    statusSubtitle.textContent = `Connecting to Instagram and resolving target account: ${input}`;
    mediaCounterBadge.textContent = '0 files isolated';
    setStepperStage('init');

    addConsoleLine(`Initializing extraction for target: ${input}`, 'highlight');

    // Connect to SSE Endpoint
    if (eventSource) eventSource.close();

    const sseUrl = `/api/scan?profile=${encodeURIComponent(input)}&sessionId=${currentSessionId}`;
    eventSource = new EventSource(sseUrl);

    eventSource.addEventListener('status', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.stage) setStepperStage(data.stage);
        if (data.message) {
          addConsoleLine(data.message);
          statusSubtitle.textContent = data.message;
        }
      } catch (err) {}
    });

    eventSource.addEventListener('scroll_progress', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.totalCount !== undefined) {
          mediaCounterBadge.textContent = `${data.totalCount} files isolated`;
        }
        if (data.message) {
          addConsoleLine(data.message);
          statusSubtitle.textContent = data.message;
        }
      } catch (err) {}
    });

    eventSource.addEventListener('media_batch', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.totalCount !== undefined) {
          mediaCounterBadge.textContent = `${data.totalCount} files isolated`;
        }
        if (data.message) {
          addConsoleLine(data.message, 'highlight');
        }
      } catch (err) {}
    });

    eventSource.addEventListener('complete', (e) => {
      try {
        const data = JSON.parse(e.data);
        eventSource.close();
        handleScanComplete(data);
      } catch (err) {
        finishScanUI(false, 'Failed to process completion payload.');
      }
    });

    eventSource.addEventListener('error', (e) => {
      let errMsg = 'Connection error or rate limit restriction from Instagram.';
      try {
        if (e.data) {
          const parsed = JSON.parse(e.data);
          if (parsed.message) errMsg = parsed.message;
        }
      } catch (err) {}

      addConsoleLine(`❌ ERROR: ${errMsg}`, 'error');
      if (eventSource) eventSource.close();
      finishScanUI(false, errMsg);
    });
  }

  function finishScanUI(isSuccess, message = '') {
    startScanBtn.style.display = 'inline-flex';
    stopScanBtn.style.display = 'none';
    statusSpinner.style.display = 'none';

    if (isSuccess) {
      statusHeading.textContent = 'Extraction Complete!';
      statusSubtitle.textContent = message || 'All target profile media isolated successfully.';
      setStepperStage('complete');
    } else {
      statusHeading.textContent = 'Extraction Stopped';
      statusSubtitle.textContent = message || 'Process was cancelled or encountered an error.';
    }
  }

  // --- Handle Completion & Render Gallery ---
  function handleScanComplete(data) {
    finishScanUI(true, data.message);
    addConsoleLine(data.message, 'highlight');

    currentProfileData = data.profile || {};
    allMediaItems = Array.isArray(data.media) ? data.media : [];

    // Render Profile Header
    if (currentProfileData.username) {
      profileUsername.textContent = `@${currentProfileData.username}`;
      profileFullName.textContent = currentProfileData.fullName || currentProfileData.username;
      profileBio.textContent = currentProfileData.biography || '';

      if (currentProfileData.avatarUrl) {
        profileAvatar.src = `/api/proxy-image?url=${encodeURIComponent(currentProfileData.avatarUrl)}`;
      }

      verifiedBadge.classList.toggle('hidden', !currentProfileData.isVerified);
      privateBadge.classList.toggle('hidden', !currentProfileData.isPrivate);

      statPostsCount.textContent = Number(currentProfileData.postsCount || 0).toLocaleString();
      statFollowersCount.textContent = Number(currentProfileData.followersCount || 0).toLocaleString();
      statExtractedCount.textContent = allMediaItems.length.toLocaleString();

      profileSection.classList.remove('hidden');
    }

    // Update Filter Tab Counts
    updateTabCounts();

    // Render Gallery Grid
    filterAndRenderGrid();
    gallerySection.classList.remove('hidden');

    // Update Download All ZIP link
    downloadAllZipBtn.onclick = () => {
      window.location.href = `/api/download-zip?sessionId=${currentSessionId}&username=${encodeURIComponent(currentProfileData?.username || 'instagram_user')}`;
    };
  }

  function updateTabCounts() {
    const total = allMediaItems.length;
    const images = allMediaItems.filter(m => m.type === 'image' && m.category !== 'highlight').length;
    const videos = allMediaItems.filter(m => m.type === 'video' && m.category !== 'highlight').length;
    const carousels = allMediaItems.filter(m => m.isCarousel).length;
    const highlights = allMediaItems.filter(m => m.category === 'highlight').length;

    countAll.textContent = total;
    countImages.textContent = images;
    countVideos.textContent = videos;
    countCarousels.textContent = carousels;
    countHighlights.textContent = highlights;
  }

  // Filter tabs click
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.getAttribute('data-filter');
      filterAndRenderGrid();
    });
  });

  function filterAndRenderGrid() {
    mediaGrid.innerHTML = '';

    let filtered = allMediaItems;
    if (currentFilter === 'image') {
      filtered = allMediaItems.filter(m => m.type === 'image' && m.category !== 'highlight');
    } else if (currentFilter === 'video') {
      filtered = allMediaItems.filter(m => m.type === 'video' && m.category !== 'highlight');
    } else if (currentFilter === 'carousel') {
      filtered = allMediaItems.filter(m => m.isCarousel);
    } else if (currentFilter === 'highlight') {
      filtered = allMediaItems.filter(m => m.category === 'highlight');
    }

    noResultsNotice.classList.toggle('hidden', filtered.length > 0);

    filtered.forEach(item => {
      const card = createMediaCard(item);
      mediaGrid.appendChild(card);
    });

    updateSelectedCounter();
  }

  function createMediaCard(item) {
    const card = document.createElement('div');
    card.className = 'media-card';
    card.setAttribute('data-id', item.id);

    // Media element
    let mediaElem;
    const proxiedPreview = `/api/proxy-image?url=${encodeURIComponent(item.previewUrl || item.url)}`;

    if (item.type === 'video') {
      mediaElem = document.createElement('video');
      mediaElem.className = 'media-preview-video';
      mediaElem.src = item.url;
      mediaElem.poster = proxiedPreview;
      mediaElem.muted = true;
      mediaElem.loop = true;
      mediaElem.preload = 'metadata';

      card.addEventListener('mouseenter', () => mediaElem.play().catch(() => {}));
      card.addEventListener('mouseleave', () => {
        mediaElem.pause();
        mediaElem.currentTime = 0;
      });
    } else {
      mediaElem = document.createElement('img');
      mediaElem.className = 'media-preview-img';
      mediaElem.src = proxiedPreview;
      mediaElem.alt = item.caption ? item.caption.slice(0, 60) : 'Instagram Photo';
      mediaElem.loading = 'lazy';
    }

    // Badge
    const badge = document.createElement('span');
    badge.className = 'card-badge';
    if (item.isCarousel) {
      badge.classList.add('badge-carousel');
      badge.textContent = `Carousel ${item.carouselIndex}/${item.carouselTotal || '?'}`;
    } else if (item.category === 'highlight') {
      badge.classList.add('badge-highlight');
      badge.textContent = 'Highlight';
    } else if (item.type === 'video') {
      badge.classList.add('badge-reel');
      badge.textContent = 'Reel / Video';
    } else {
      badge.textContent = 'Photo';
    }

    // Checkbox for selection
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'card-checkbox';
    checkbox.checked = selectedMediaIds.has(item.id);
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      if (checkbox.checked) {
        selectedMediaIds.add(item.id);
      } else {
        selectedMediaIds.delete(item.id);
      }
      updateSelectedCounter();
    });

    // Hover Overlay
    const overlay = document.createElement('div');
    overlay.className = 'card-overlay';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'overlay-info';

    if (item.caption) {
      const cap = document.createElement('p');
      cap.className = 'overlay-caption';
      cap.textContent = item.caption;
      infoDiv.appendChild(cap);
    }

    const res = document.createElement('p');
    res.className = 'overlay-resolution';
    res.textContent = `${item.resolution || 'Original Quality'} • ${item.type.toUpperCase()}`;
    infoDiv.appendChild(res);

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'overlay-actions';

    const downloadBtn = document.createElement('a');
    downloadBtn.className = 'card-download-btn';
    downloadBtn.href = `/api/download-single?url=${encodeURIComponent(item.url)}&filename=${encodeURIComponent(item.filename)}`;
    downloadBtn.download = item.filename;
    downloadBtn.innerHTML = '⬇ Download';
    downloadBtn.addEventListener('click', (e) => e.stopPropagation());

    const expandBtn = document.createElement('button');
    expandBtn.className = 'card-expand-btn';
    expandBtn.innerHTML = '🔍 View';
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openLightbox(item);
    });

    actionsDiv.appendChild(downloadBtn);
    actionsDiv.appendChild(expandBtn);

    overlay.appendChild(infoDiv);
    overlay.appendChild(actionsDiv);

    card.appendChild(badge);
    card.appendChild(checkbox);
    card.appendChild(mediaElem);
    card.appendChild(overlay);

    card.addEventListener('click', () => openLightbox(item));

    return card;
  }

  // --- Selection Controls ---
  selectAllBtn.addEventListener('click', () => {
    let currentShown = allMediaItems;
    if (currentFilter === 'image') currentShown = allMediaItems.filter(m => m.type === 'image' && m.category !== 'highlight');
    else if (currentFilter === 'video') currentShown = allMediaItems.filter(m => m.type === 'video' && m.category !== 'highlight');
    else if (currentFilter === 'carousel') currentShown = allMediaItems.filter(m => m.isCarousel);
    else if (currentFilter === 'highlight') currentShown = allMediaItems.filter(m => m.category === 'highlight');

    const allSelected = currentShown.every(m => selectedMediaIds.has(m.id));

    if (allSelected) {
      currentShown.forEach(m => selectedMediaIds.delete(m.id));
      selectAllBtn.textContent = 'Select All';
    } else {
      currentShown.forEach(m => selectedMediaIds.add(m.id));
      selectAllBtn.textContent = 'Deselect All';
    }

    document.querySelectorAll('.card-checkbox').forEach(cb => {
      const cardId = cb.closest('.media-card')?.getAttribute('data-id');
      cb.checked = selectedMediaIds.has(cardId);
    });

    updateSelectedCounter();
  });

  function updateSelectedCounter() {
    selectedCount.textContent = selectedMediaIds.size;
    downloadSelectedBtn.disabled = selectedMediaIds.size === 0;
  }

  // Download Selected (ZIP)
  downloadSelectedBtn.addEventListener('click', async () => {
    if (selectedMediaIds.size === 0) return;

    const itemsToDownload = allMediaItems.filter(m => selectedMediaIds.has(m.id));
    downloadSelectedBtn.disabled = true;
    downloadSelectedBtn.textContent = 'Packaging ZIP...';

    try {
      const res = await fetch('/api/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: currentProfileData?.username || 'instagram_user',
          items: itemsToDownload
        })
      });

      if (!res.ok) throw new Error('ZIP packaging failed on server.');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentProfileData?.username || 'instagram'}_selected_${itemsToDownload.length}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(`ZIP Download Failed: ${err.message}`);
    } finally {
      updateSelectedCounter();
      downloadSelectedBtn.innerHTML = `<span>⬇️</span> Download Selected (<span id="selectedCount">${selectedMediaIds.size}</span>)`;
    }
  });

  // --- Lightbox Modal ---
  function openLightbox(item) {
    lightboxMediaContainer.innerHTML = '';

    if (item.type === 'video') {
      const vid = document.createElement('video');
      vid.src = item.url;
      vid.controls = true;
      vid.autoplay = true;
      lightboxMediaContainer.appendChild(vid);
    } else {
      const img = document.createElement('img');
      img.src = `/api/proxy-image?url=${encodeURIComponent(item.url)}`;
      img.alt = item.caption || 'Instagram Photo';
      lightboxMediaContainer.appendChild(img);
    }

    lightboxCategory.textContent = (item.category || item.type).toUpperCase();
    lightboxResolution.textContent = item.resolution || 'Original Quality';
    lightboxCaption.textContent = item.caption || 'No caption available.';

    if (item.postUrl) {
      lightboxIgLink.style.display = 'inline-flex';
      lightboxIgLink.href = item.postUrl;
    } else {
      lightboxIgLink.style.display = 'none';
    }

    lightboxDownloadBtn.href = `/api/download-single?url=${encodeURIComponent(item.url)}&filename=${encodeURIComponent(item.filename)}`;
    lightboxDownloadBtn.download = item.filename;

    lightboxModal.classList.remove('hidden');
  }

  closeLightboxBtn.addEventListener('click', () => {
    lightboxModal.classList.add('hidden');
    lightboxMediaContainer.innerHTML = '';
  });
});
