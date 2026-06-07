// Interactive Controller for Gwandongbyeolgok Learning Platform
// Handles Data Binding, Kakao Maps Integration, IPC File Storage, and Quiz Engine

// Environment Bridge Wrapper for Hybrid Dual-Mode (Electron & Web Browser)
if (typeof window.api === 'undefined') {
  window.api = {
    readSettings: async () => {
      const val = localStorage.getItem('gwandong_settings');
      if (!val) {
        const defaultSettings = {
          kakao_api_key: '',
          last_location_id: 'hanyang',
          completed_quizzes: []
        };
        localStorage.setItem('gwandong_settings', JSON.stringify(defaultSettings));
        return defaultSettings;
      }
      return JSON.parse(val);
    },
    writeSettings: async (newSettings) => {
      localStorage.setItem('gwandong_settings', JSON.stringify(newSettings));
      return { success: true };
    },
    readGwandongData: async () => {
      try {
        const res = await fetch('data/gwandong.json');
        if (!res.ok) throw new Error('Network response was not ok');
        return await res.json();
      } catch (err) {
        console.error('Failed to fetch gwandong data:', err);
        return null;
      }
    },
    writeGwandongData: async (updatedData) => {
      // Browsers cannot write back to local files directly, return success state
      return { success: true };
    }
  };
}

let settings = {
  kakao_api_key: '',
  last_location_id: '',
  completed_quizzes: []
};
let spots = [];
let map = null;
let mapMarkers = {};
let mapPolyline = null;
let currentActiveSpotId = null;
let currentQuizSpot = null;

// DOM Elements
const locationListEl = document.getElementById('location-list');
const progressBarFillEl = document.getElementById('progress-bar-fill');
const progressTextEl = document.getElementById('progress-text');

// Floating Detail Card Elements
const detailCardEl = document.getElementById('detail-card');
const detailPhotoEl = document.getElementById('detail-photo');
const detailSpotBadgeEl = document.getElementById('detail-spot-badge');
const detailTitleEl = document.getElementById('detail-title');
const detailSnippetEl = document.getElementById('detail-snippet');
const detailDescEl = document.getElementById('detail-description');
const detailQuizTriggerEl = document.getElementById('detail-quiz-trigger');
const closeDetailBtn = document.getElementById('close-detail-btn');

// Overlays & Modals
const setupOverlayEl = document.getElementById('setup-overlay');
const settingsOverlayEl = document.getElementById('settings-overlay');
const quizModalEl = document.getElementById('quiz-modal');

// Key Form
const kakaoKeyInputEl = document.getElementById('kakao-key-input');
const saveKeyBtn = document.getElementById('save-key-btn');

// Settings Overlay
const settingsKeyInputEl = document.getElementById('settings-key-input');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const settingsBtn = document.getElementById('settings-btn');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const resetProgressBtn = document.getElementById('reset-progress-btn');

// Quiz Modal Elements
const quizLocationTitleEl = document.getElementById('quiz-location-title');
const quizQuestionEl = document.getElementById('quiz-question');
const quizOptionsEl = document.getElementById('quiz-options');
const quizFeedbackEl = document.getElementById('quiz-feedback');
const feedbackIconEl = document.getElementById('feedback-icon');
const feedbackTitleEl = document.getElementById('feedback-title');
const quizExplanationEl = document.getElementById('quiz-explanation');
const quizNextBtn = document.getElementById('quiz-next-btn');
const quizCloseBtn = document.getElementById('quiz-close-btn');

/* ==========================================================================
   Initialization and Startup Logic
   ========================================================================== */
window.addEventListener('DOMContentLoaded', async () => {
  // 1. Load Settings and Data from IPC
  await loadAppData();
  
  // 2. Setup Base Event Listeners
  setupCoreEvents();
  
  // 3. Render left pane UI cards
  renderSpotCards();
  updateProgressUI();

  // 4. Initialize Map or Setup Screen based on API Key
  if (!settings.kakao_api_key || settings.kakao_api_key.trim() === '') {
    showOverlay(setupOverlayEl);
  } else {
    initKakaoMapSystem();
  }
});

// Load settings and dataset via Electron IPC
async function loadAppData() {
  try {
    const loadedSettings = await window.api.readSettings();
    if (loadedSettings) {
      settings = loadedSettings;
    }
    
    const loadedData = await window.api.readGwandongData();
    if (loadedData) {
      spots = loadedData;
    } else {
      // Fallback: If gwandong.json is missing or corrupted, create it dynamically
      console.log("No seed data found, installing default Gwandong dataset.");
      const fallbackData = await getFallbackGwandongData();
      await window.api.writeGwandongData(fallbackData);
      spots = fallbackData;
    }
  } catch (err) {
    console.error('Failed to load application data:', err);
  }
}

// Bind core user interface actions
function setupCoreEvents() {
  // Setup Overlay Save
  saveKeyBtn.addEventListener('click', async () => {
    const key = kakaoKeyInputEl.value.trim();
    if (key === '') {
      alert('유효한 카카오 JavaScript 키를 입력해 주세요.');
      return;
    }
    settings.kakao_api_key = key;
    await window.api.writeSettings(settings);
    hideOverlay(setupOverlayEl);
    initKakaoMapSystem();
  });

  // Settings Modal Open
  settingsBtn.addEventListener('click', () => {
    settingsKeyInputEl.value = settings.kakao_api_key;
    showOverlay(settingsOverlayEl);
  });

  // Settings Modal Close
  closeSettingsBtn.addEventListener('click', () => {
    hideOverlay(settingsOverlayEl);
  });

  // Settings Modal Save
  saveSettingsBtn.addEventListener('click', async () => {
    const newKey = settingsKeyInputEl.value.trim();
    if (newKey !== settings.kakao_api_key) {
      settings.kakao_api_key = newKey;
      await window.api.writeSettings(settings);
      alert('설정이 저장되었습니다. 지도를 다시 불러오기 위해 앱이 재구동됩니다.');
      window.location.reload();
    } else {
      hideOverlay(settingsOverlayEl);
    }
  });

  // Reset Progress Handler
  resetProgressBtn.addEventListener('click', async () => {
    if (confirm('모든 학습 진도 및 카카오 API 설정이 초기화되며 처음 상태로 되돌아갑니다. 진행하시겠습니까?')) {
      const defaultSettings = {
        kakao_api_key: '',
        last_location_id: 'hanyang',
        completed_quizzes: []
      };
      await window.api.writeSettings(defaultSettings);
      window.location.reload();
    }
  });

  // Floating card close button
  closeDetailBtn.addEventListener('click', () => {
    hideDetailCard();
  });

  // Quiz Modal Close Buttons
  quizCloseBtn.addEventListener('click', closeQuizModal);
  quizNextBtn.addEventListener('click', closeQuizModal);
}

/* ==========================================================================
   Kakao Maps API Loader
   ========================================================================== */
function initKakaoMapSystem() {
  const mapContainer = document.getElementById('map');
  mapContainer.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>카카오 지도를 불러오는 중입니다...</p></div>';

  loadKakaoScript(settings.kakao_api_key)
    .then(() => {
      // Clear loading state and initialize
      mapContainer.innerHTML = '';
      setupKakaoMapObject();
      setupMapRoutesAndMarkers();
      
      // Auto-restore last studied spot
      if (settings.last_location_id) {
        // Delay slightly for map rendering completion
        setTimeout(() => {
          selectSpot(settings.last_location_id, false);
        }, 300);
      }
    })
    .catch((err) => {
      console.error(err);
      mapContainer.innerHTML = `
        <div class="loading-state" style="padding: 20px; text-align: center;">
          <p style="color: var(--crimson-accent); font-weight: 700; font-size: 1.1rem; margin-bottom: 10px;">🗺️ 지도 로딩 실패</p>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 15px; max-width: 80%;">
            카카오 지도 API 키가 올바르지 않거나 네트워크 연결이 불안정합니다. 설정(⚙️)을 눌러 키가 제대로 등록되었는지 확인하세요.
          </p>
          <button onclick="document.getElementById('settings-btn').click()" class="btn btn-secondary btn-sm">⚙️ API 설정 변경</button>
        </div>
      `;
    });
}

// Inserts and coordinates autoload Kakao script
function loadKakaoScript(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.kakao && window.kakao.maps) {
      resolve();
      return;
    }
    
    // Cleanup any duplicate scripts
    const oldScript = document.getElementById('kakao-sdk');
    if (oldScript) oldScript.remove();

    const script = document.createElement('script');
    script.id = 'kakao-sdk';
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&autoload=false`;
    script.onload = () => {
      kakao.maps.load(() => {
        if (window.kakao && window.kakao.maps) {
          resolve();
        } else {
          reject(new Error('Kakao Maps Object is not defined after load'));
        }
      });
    };
    script.onerror = () => {
      reject(new Error('Kakao Maps API script load failed'));
    };
    document.head.appendChild(script);
  });
}

// Build map layout options
function setupKakaoMapObject() {
  const container = document.getElementById('map');
  
  // Center of Korea Peninsula
  const defaultCenter = new kakao.maps.LatLng(37.8000, 128.1000);
  const options = {
    center: defaultCenter,
    level: 10 // Wide overview zoom level
  };
  
  map = new kakao.maps.Map(container, options);
  
  // Add standard map controllers
  const mapTypeControl = new kakao.maps.MapTypeControl();
  map.addControl(mapTypeControl, kakao.maps.ControlPosition.TOPRIGHT);

  const zoomControl = new kakao.maps.ZoomControl();
  map.addControl(zoomControl, kakao.maps.ControlPosition.RIGHT);
}

// Set up geo markers and route polylines
function setupMapRoutesAndMarkers() {
  if (!map || spots.length === 0) return;

  const pathCoords = [];

  spots.forEach((spot) => {
    const latlng = new kakao.maps.LatLng(spot.lat, spot.lng);
    pathCoords.push(latlng);

    // Create custom DOM label for markers instead of static pins
    const markerContent = document.createElement('div');
    markerContent.className = 'kakao-overlay-label';
    markerContent.id = `marker-${spot.id}`;
    // Display shortened title without index number
    markerContent.textContent = spot.location_name.split(' (')[0];
    
    // Add interactive click synchronization
    markerContent.addEventListener('click', () => {
      selectSpot(spot.id, true);
    });

    const overlay = new kakao.maps.CustomOverlay({
      content: markerContent,
      position: latlng,
      yAnchor: 1.5,
      zIndex: 3
    });

    overlay.setMap(map);
    mapMarkers[spot.id] = { overlay, element: markerContent };
  });

  // Connect spots with journey route polyline
  mapPolyline = new kakao.maps.Polyline({
    path: pathCoords,
    strokeWeight: 4,
    strokeColor: '#0E6273', // --ocean-cyan
    strokeOpacity: 0.7,
    strokeStyle: 'solid'
  });

  mapPolyline.setMap(map);
}

/* ==========================================================================
   Left Panel View Builder (Data Bindings)
   ========================================================================== */
function renderSpotCards() {
  locationListEl.innerHTML = '';
  
  if (spots.length === 0) {
    locationListEl.innerHTML = '<p class="loading-state">등록된 학습 데이터가 없습니다.</p>';
    return;
  }

  spots.forEach((spot) => {
    const isCompleted = settings.completed_quizzes.includes(spot.id);
    const badgeText = isCompleted ? '✅ 학습 완료' : '📝 학습 대기';
    const badgeClass = isCompleted ? 'badge badge-status completed' : 'badge badge-status';

    const card = document.createElement('div');
    card.className = 'spot-card';
    card.id = `card-${spot.id}`;
    
    // Click card action
    card.addEventListener('click', (e) => {
      // Don't trigger if user clicked quiz button specifically
      if (e.target.closest('.btn')) return;
      selectSpot(spot.id, true);
    });

    card.innerHTML = `
      <div class="card-header">
        <div class="card-title-group">
          <h3>${spot.title}</h3>
          <span class="card-location-sub">📍 ${spot.location_name}</span>
        </div>
        <div class="card-badges">
          <span class="badge badge-coord">N ${spot.lat.toFixed(3)} / E ${spot.lng.toFixed(3)}</span>
          <span id="badge-${spot.id}" class="${badgeClass}">${badgeText}</span>
        </div>
      </div>
      
      <div class="poem-box">
        <p class="original-verse">${spot.original_text}</p>
        <div class="verse-divider"></div>
        <p class="modern-verse">${spot.modern_translation}</p>
      </div>

      <div class="analysis-box">
        <h4>시어 풀이 & 문학 설명</h4>
        <p>${spot.analysis}</p>
      </div>

      <div class="card-actions">
        <button class="btn btn-secondary btn-sm select-on-map-btn" data-id="${spot.id}">
          🔍 지도 위치 보기
        </button>
        <button class="btn btn-primary btn-sm quiz-btn" data-id="${spot.id}">
          🎯 형성 평가 퀴즈
        </button>
      </div>
    `;

    locationListEl.appendChild(card);
  });

  // Bind individual card buttons
  document.querySelectorAll('.select-on-map-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      selectSpot(id, true);
    });
  });

  document.querySelectorAll('.quiz-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      openQuizModal(id);
    });
  });
}

// Synchronize Spot Selection (Left Panel card <-> Right Map pin)
async function selectSpot(spotId, shouldPan = true) {
  const spot = spots.find(s => s.id === spotId);
  if (!spot) return;

  // 1. Remove active state from old selection
  if (currentActiveSpotId) {
    const oldCard = document.getElementById(`card-${currentActiveSpotId}`);
    if (oldCard) oldCard.classList.remove('active');
    
    const oldMarker = mapMarkers[currentActiveSpotId];
    if (oldMarker && oldMarker.element) {
      oldMarker.element.classList.remove('active');
    }
  }

  // 2. Apply active state to new selection
  currentActiveSpotId = spotId;
  
  const newCard = document.getElementById(`card-${spotId}`);
  if (newCard) {
    newCard.classList.add('active');
    // Scroll left panel card into view smoothly
    newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const newMarker = mapMarkers[spotId];
  if (newMarker && newMarker.element) {
    newMarker.element.classList.add('active');
  }

  // 3. Pan and focus Kakao Map to coordinates
  if (map && shouldPan) {
    const coords = new kakao.maps.LatLng(spot.lat, spot.lng);
    map.panTo(coords);
    
    // Zoom in a bit if map is zoomed too far out
    if (map.getLevel() > 7) {
      map.setLevel(7);
    }
  }

  // 4. Update and show the floating visual detail card
  showDetailCard(spot);

  // 5. Update user progress data in file (settings.json)
  if (settings.last_location_id !== spotId) {
    settings.last_location_id = spotId;
    await window.api.writeSettings(settings);
  }
}

/* ==========================================================================
   Floating Detail Card Display
   ========================================================================== */
function showDetailCard(spot) {
  detailPhotoEl.src = spot.photo_url;
  detailSpotBadgeEl.textContent = spot.location_name.split(' (')[0];
  detailTitleEl.textContent = spot.title;
  
  // Extract first line of poem for snippet
  const firstLine = spot.original_text.split('\n')[0] || '';
  detailSnippetEl.textContent = `"${firstLine}"`;
  
  // Construct description out of translation & coordinate details
  detailDescEl.textContent = spot.modern_translation.split('\n')[0];
  
  // Connect quiz trigger button
  detailQuizTriggerEl.onclick = () => {
    openQuizModal(spot.id);
  };

  detailCardEl.classList.remove('hidden');
}

function hideDetailCard() {
  detailCardEl.classList.add('hidden');
}

/* ==========================================================================
   Quiz Engine
   ========================================================================== */
function openQuizModal(spotId) {
  const spot = spots.find(s => s.id === spotId);
  if (!spot || !spot.quiz) return;

  currentQuizSpot = spot;
  
  // Reset previous quiz feedback states
  quizFeedbackEl.classList.add('hidden');
  quizNextBtn.classList.add('hidden');
  
  // Render details
  quizLocationTitleEl.textContent = spot.title;
  quizQuestionEl.textContent = spot.quiz.question;
  
  quizOptionsEl.innerHTML = '';
  
  spot.quiz.options.forEach((option, idx) => {
    const button = document.createElement('button');
    button.className = 'option-btn';
    button.innerHTML = `
      <span class="option-num">${idx + 1}</span>
      <span class="option-text">${option}</span>
    `;
    
    button.addEventListener('click', () => handleOptionClick(idx));
    quizOptionsEl.appendChild(button);
  });

  showOverlay(quizModalEl);
}

async function handleOptionClick(selectedIdx) {
  const quiz = currentQuizSpot.quiz;
  const options = quizOptionsEl.querySelectorAll('.option-btn');
  
  // Disable all options once clicked to prevent multi-clicking
  options.forEach((btn, idx) => {
    btn.classList.add('disabled');
    if (idx === quiz.answer_idx) {
      btn.classList.add('correct');
    }
  });

  const isCorrect = (selectedIdx === quiz.answer_idx);
  
  // Style correct/incorrect items
  if (isCorrect) {
    options[selectedIdx].classList.remove('disabled');
    
    // Show correct feedback container
    quizFeedbackEl.className = 'quiz-feedback-box correct';
    feedbackIconEl.textContent = '✅';
    feedbackTitleEl.textContent = '정답입니다!';
    
    // Append to settings if not already completed
    if (!settings.completed_quizzes.includes(currentQuizSpot.id)) {
      settings.completed_quizzes.push(currentQuizSpot.id);
      await window.api.writeSettings(settings);
      
      // Update badge in left card instantly
      const badge = document.getElementById(`badge-${currentQuizSpot.id}`);
      if (badge) {
        badge.textContent = '✅ 학습 완료';
        badge.className = 'badge badge-status completed';
      }
      
      updateProgressUI();
    }
  } else {
    options[selectedIdx].classList.remove('disabled');
    options[selectedIdx].classList.add('incorrect');
    
    // Show incorrect feedback container
    quizFeedbackEl.className = 'quiz-feedback-box incorrect';
    feedbackIconEl.textContent = '❌';
    feedbackTitleEl.textContent = '오답입니다. 다시 한번 생각해 보세요!';
  }

  // Display academic explanation
  quizExplanationEl.textContent = quiz.explanation;
  quizFeedbackEl.classList.remove('hidden');
  quizNextBtn.classList.remove('hidden');
}

function closeQuizModal() {
  hideOverlay(quizModalEl);
  currentQuizSpot = null;
}

/* ==========================================================================
   Progress tracker updater
   ========================================================================== */
function updateProgressUI() {
  if (spots.length === 0) return;
  
  const completedCount = settings.completed_quizzes.length;
  const totalCount = spots.length;
  const percentage = Math.round((completedCount / totalCount) * 100);
  
  progressBarFillEl.style.width = `${percentage}%`;
  progressTextEl.textContent = `${percentage}% (${completedCount}/${totalCount} 완료)`;
}

/* ==========================================================================
   Overlay Helper Utilities
   ========================================================================== */
function showOverlay(overlayEl) {
  overlayEl.classList.remove('hidden');
}

function hideOverlay(overlayEl) {
  overlayEl.classList.add('hidden');
}

/* ==========================================================================
   Fallback Database Generator
   ========================================================================== */
async function getFallbackGwandongData() {
  // Return the default data JSON structures
  return [
    {
      "id": "hanyang",
      "title": "1. 부임과 출발 (한양)",
      "location_name": "한양 (경복궁 연추문)",
      "lat": 37.5780,
      "lng": 126.9769,
      "original_text": "강호(江湖)에 병(病)이 깁퍼 쥭림(竹林)에 누엇더니,\n관동(關東) 팔백리(八百里)에 방면(方面)을 맛디시니,\n어와 성은(聖恩)이야 갈수록 망극(罔極)하다.\n연추문(延秋門) 드리달아 경회남문(慶會南門) 바라보며,\n하직(下직)고 물러나니 옥졀(玉節)이 앞에 셧다.",
      "modern_translation": "자연을 사랑하는 깊은 병(고질적인 자연 애호)이 생겨 전남 창평(죽림)에 은거하고 있었는데, 임금님께서 강원도(관동) 팔백리 땅의 관찰사 임무를 맡겨주시니,\n아아, 임금님의 은혜가 갈수록 끝이 없구나.\n경복궁의 서문인 연추문으로 달려 들어가 경회루 남쪽 문을 바라보며,\n임금님께 작별 인사를 드리고 물러나니, 관찰사의 신표인 옥절이 벌써 앞길에 서 있구나.",
      "analysis": "정철이 관찰사로 임명받고 급히 서울 경복궁으로 올라와 임금께 하직을 고하고 임지로 출발하는 격정적이고 속도감 넘치는 대목입니다. 출발의 설렘과 임금에 대한 무한한 감사가 웅장하게 표현되어 있습니다.",
      "photo_url": "https://images.unsplash.com/photo-1540959733332-eab4deceeaf7?auto=format&fit=crop&w=800&q=80",
      "quiz": {
        "question": "화자가 관찰사 임명을 받고 기쁨과 충성심을 드러내는 구절 중 '연추문 드리달아 경회남문 바라보며'에서 느낄 수 있는 여정상의 서술 특징은 무엇인가요?",
        "options": [
          "지루한 부임 과정을 사실적이고 상세하게 기술하였다.",
          "한양으로 가는 길과 임금과의 이별 과정을 극도로 신속하게 생략 전개하였다.",
          "임지에서의 정치적 갈등과 두려움을 간접적으로 드러낸다.",
          "자연을 떠나는 아쉬움에 발걸음이 무겁게 지체되고 있음을 나타낸다."
        ],
        "answer_idx": 1,
        "explanation": "관찰사 배수 후 한양으로 향하고 임금께 이별을 고하고 출발하는 일련의 과정이 생략과 비약을 통해 역동적이고 빠르게 전개되어 화자의 설렘과 신속한 행보를 묘사합니다."
      }
    },
    {
      "id": "soyanggang",
      "title": "2. 연군의 정 (소양강)",
      "location_name": "소양강 (강원도 춘천)",
      "lat": 37.9042,
      "lng": 127.7554,
      "original_text": "평구역(平丘驛) 말을 가라 석우(石隅)로 디나 드러,\n소양강(昭陽江) 나린 물이 어디로 든단 말인고.\n고신(孤臣) 거국(去國)에 백발(白髮)도 하도 할샤.",
      "modern_translation": "평구역(경기도 남양주)에서 말을 갈아타고 석우를 지나 소양강에 들어서니,\n이 소양강에서 흘러내리는 물은 어디로 흘러간단 말인가? (결국 임금이 계신 한양의 한강으로 갈 터이니)\n나라를 떠나 변방으로 가는 외로운 신하의 머리에 우국(憂國)과 연군(戀君)의 근심으로 백발이 늘어만 가는구나.",
      "analysis": "강물이 한강(한양)으로 흐르는 것을 바라보며 임금에 대한 그리움과 충정을 은유적으로 노래한 대목입니다. 나라를 걱정하는 외로운 신하의 깊은 시름이 '백발'이라는 시어로 형상화되었습니다.",
      "photo_url": "https://images.unsplash.com/photo-1619890831007-aa154e3602b2?auto=format&fit=crop&w=800&q=80",
      "quiz": {
        "question": "'소양강 나린 물이 어디로 든단 말인고'라는 시구에 직접적으로 투영되어 있는 화자의 핵심 정서는?",
        "options": [
          "안빈낙도(安貧樂道)",
          "연군의 정 및 우국지정(憂國之情)",
          "자연과의 혼연일체(물아일체)",
          "정치적 권력 다툼에 대한 환멸"
        ],
        "answer_idx": 1,
        "explanation": "소양강 물이 한양의 한강으로 갈 것임을 떠올리며 임금님을 그리워하고 나라 일을 염려하는 우국지정과 임금을 향한 그리움(연군의 정)이 투영되어 있습니다."
      }
    },
    {
      "id": "hoeyang",
      "title": "3. 목민관의 포부 (회양)",
      "location_name": "회양 (강원도 북측 회양군)",
      "lat": 38.4526,
      "lng": 127.6080,
      "original_text": "회양(淮陽) 네 일홈이 마초아 가탈시고.\n급장유(汲長孺) 풍채(風采)를 고텨 아니 볼 게이고.",
      "modern_translation": "내가 이른 고을 이름인 '회양'이 마침 옛날 중국 한나라의 선정으로 이름 높던 고을 '회양'과 이름이 똑같구나.\n그 옛날 중국 회양에서 누워서 다스리며 훌륭한 정치를 베풀었다는 '급장유'의 훌륭한 풍모를 이곳 강원도 회양에서 다시 보게 하지 않겠는가? (나 역시 급장유처럼 멋진 정치를 펼쳐 보이겠다.)",
      "analysis": "자신이 도달한 고을 이름이 한나라 명목민관 급장유의 임지와 같음을 이용해, 자신도 백성들을 잘 다스리겠다는 목민관으로서의 선정(善政)의 포부를 함축적으로 다짐하는 장면입니다.",
      "photo_url": "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80",
      "quiz": {
        "question": "화자가 고대 중국의 목민관 '급장유'를 소환하여 드러내고자 하는 궁극적인 의지는 무엇인가요?",
        "options": [
          "벼슬을 버리고 고향으로 낙향하겠다는 의지",
          "학문적 업적을 쌓기 위해 정사에 관여하지 않겠다는 의지",
          "관할 백성들에게 좋은 행정을 베풀어 선정을 펴겠다는 포부",
          "적을 물리쳐 영토를 지키겠다는 국방의 의지"
        ],
        "answer_idx": 2,
        "explanation": "중국 한나라 회양 태수 시절 선정을 펼쳐 명성을 쌓은 '급장유'에 자신을 빗대어, 강원도 회양 관찰사로서 훌륭한 정치를 펴겠다는 의지(선정의 포부)를 담고 있습니다."
      }
    },
    {
      "id": "manpokdong",
      "title": "4. 금강산의 비경 (만폭동)",
      "location_name": "금강산 만폭동 (강원도 고성)",
      "lat": 38.6496,
      "lng": 128.0931,
      "original_text": "만폭동(萬瀑洞) 맛외기 골 드러가니,\n외나무 다리 아래 폭포(瀑布)를 보아하니,\n은(銀) 무지게 가탄 옷(衣) 용(龍)의 초리 가탄 서리러라.\n들을 제난 우레러니 보니난 눈이로다.",
      "modern_translation": "만폭동 골짜기 입구로 들어가서 외나무다리 아래 세차게 쏟아지는 폭포를 바라보니,\n마치 은색 무지개 같고, 용의 꼬리처럼 희게 흩어지며 서리가 서린 기세로구나.\n멀리서 물소리를 들을 때는 천둥소리(우레) 같더니, 가까이 다가와 눈으로 직접 바라보니 온통 새하얗게 튀는 눈(눈꽃)과 같도다.",
      "analysis": "금강산에 들어서 만폭동 계곡의 거대한 폭포를 직면했을 때의 감동을 역동적인 은유와 대조법으로 표현했습니다. 소리(청각, 우레)와 시각(눈)의 환상적인 대비가 폭포의 장엄함을 한껏 고조시킵니다.",
      "photo_url": "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=800&q=80",
      "quiz": {
        "question": "'들을 제난 우레러니 보니난 눈이로다'에 활용된 감각적 심상의 대비 구조로 가장 알맞은 것은?",
        "options": [
          "소리(청각)와 시각의 절묘한 대조를 통해 폭포의 장엄함을 강조한다.",
          "미각적 쾌감을 시각화하여 표현하였다.",
          "정적인 촉각을 통해 고요한 분위기를 연출한다.",
          "구름을 바람에 빗대어 하강의 심상을 유도한다."
        ],
        "answer_idx": 0,
        "explanation": "멀리서 청각적으로 들려오던 웅장한 천둥소리(우레)가 가까이서 관찰할 때 희고 찬란한 눈(시각)으로 대조 및 조화되는 것을 나타낸 구절입니다."
      }
    },
    {
      "id": "uisangdae",
      "title": "5. 동해 일출의 장관 (의상대)",
      "location_name": "낙산사 의상대 (강원도 양양)",
      "lat": 38.1257,
      "lng": 128.6294,
      "original_text": "니산(梨山) 동대(東臺) 가마이 발하 오라,\n일출(日出)을 보려사 밤즁만 디나 일어하니,\n상운(祥雲)이 집희난 동 일운(日暈)이 듸미난 동,\n육룡(六龍)이 누리난 동 바다해 떠날 제난 만국(萬國)이 일위더니,\n텬즁(天중)의 티뜨니 호발(毫髮)을 혜리로다.",
      "modern_translation": "낙산사 동쪽 언덕(의상대)에 가만히 올라서서,\n동해 일출을 보기 위해 깊은 밤이 지나자마자 일어나니,\n상서로운 구름이 뭉게뭉게 피어나는 듯, 해의 테두리가 하늘을 밀어 올리는 듯,\n마치 여섯 마리 용이 태양을 보좌하여 떠받치고 노니는 듯하구나. 마침내 바다에서 해가 솟아오를 때는 온 세상이 요동치더니,\n하늘 한가운데 완전히 솟아오르자 아주 가는 머리카락(터럭) 한 올까지도 다 셀 수 있을 만큼 세상이 환하게 밝아오는구나.",
      "analysis": "낙산사 의상대에서 목격한 동해의 찬란한 해돋이 장면입니다. 해를 받드는 '육룡'은 임금을 돕는 충신들을 뜻하며, 머리카락을 셀 정도로 밝은 해(호발을 혜리로다)는 백성을 고루 살피는 임금의 영명한 총명함과 선정을 상징합니다.",
      "photo_url": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80",
      "quiz": {
        "question": "'텬즁의 티뜨니 호발을 혜리로다'라는 구절이 내포하고 있는 정치/사회적 상징 의미는?",
        "options": [
          "조정에 가득 찬 간신들의 간사함을 풍자한다.",
          "세상이 도탄에 빠져 극도로 피폐해졌음을 암시한다.",
          "임금의 총명한 영명함이 세상을 환히 비추어 간신배가 활개치지 못하는 밝은 정치를 소망한다.",
          "화자 자신의 권력에 대한 야망과 탐욕을 표현한다."
        ],
        "answer_idx": 2,
        "explanation": "하늘 중천에 높이 솟은 해가 가느다란 터럭까지 다 비춘다는 표현은 임금의 지혜롭고 자비로운 통치 빛(선정)이 나라 전체 구석구석 미치는 것을 비유합니다."
      }
    },
    {
      "id": "mangyangjeong",
      "title": "6. 갈등의 고조와 해소 (망양정)",
      "location_name": "망양정 (강원도 울진)",
      "lat": 36.9859,
      "lng": 129.4124,
      "original_text": "하날 긋티 가이 업서 바다 밧근 하날이니,\n가뜩 노한 고래 뉘라셔 놀래관대,\n불거니 뿜거니 어즈러이 구난디.\n은산(銀山)을 것거 내여 육합(六合)의 나리는 듯,\n오월(五월) 댱텬(長天)의 백설(白雪)은 무슨 일고.",
      "modern_translation": "끝없는 하늘 저 바깥도 하늘인데,\n가뜩이나 노여워하는 거대한 고래(파도)를 누가 놀라게 했기에,\n물을 불어 대고 뿜어 대며 어지럽게 요동치는가?\n마치 거대한 은으로 만든 산을 깨뜨려 세상에 뿌려 내리는 듯,\n화창한 한여름 오월의 너른 하늘에 휘날리는 하얀 백설(거품과 물방울)은 도대체 무슨 일인가!",
      "analysis": "망양정에서 바라본 장대한 바다와 성난 듯 몰아치는 파도를 비유적 심상('고래', '은산', '백설')으로 묘사한 백미입니다. 광활한 바다 앞에서 공직자로서의 책임(위정자의 의무)과 자연을 즐기는 개인적 욕망(신선적 풍류) 사이에서 고뇌와 갈등이 극에 달해 요동치는 파도처럼 묘사되어 있습니다.",
      "photo_url": "https://images.unsplash.com/photo-1544735716-392fe2489ffa?auto=format&fit=crop&w=800&q=80",
      "quiz": {
        "question": "망양정 대목에서 거칠게 휘몰아치는 바다의 '파도'와 '포말'을 묘사하기 위해 사용된 보조관념이 아닌 것은?",
        "options": [
          "고래",
          "은산(銀山)",
          "백설(白雪)",
          "옥졀(玉節)"
        ],
        "answer_idx": 3,
        "explanation": "'옥절(玉節)'은 임금이 내린 관할관의 신표이며, 거세게 일렁이며 하얗게 깨어지는 파도를 비유한 시어는 '고래', '은산', '백설'입니다."
      }
    }
  ];
}
