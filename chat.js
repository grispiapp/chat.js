'use strict';

{
  const VERSION = '0.1.5';
  console.log(`Grispi chat.js ${VERSION}`);
  window.GRISPI_CHAT_JS_VERSION = VERSION;
}

{
  let timeoutHandle;
  let idleSince = Date.now();
  window.addEventListener('load', resetTimer);
  window.addEventListener('mousemove', resetTimer);
  window.addEventListener('mousedown', resetTimer);  // catches touchscreen presses as well
  window.addEventListener('touchstart', resetTimer); // catches touchscreen swipes as well
  window.addEventListener('touchmove', resetTimer);  // required by some devices
  window.addEventListener('click', resetTimer);      // catches touchpad clicks as well
  window.addEventListener('keydown', resetTimer);
  window.addEventListener('scroll', resetTimer, true); // improved; see comments

  function idleCallback() {
    //console.warn('chat.js idle detected');
    //TODO send idleSince info along with an idle event (a new event type)
  }

  function resetTimer() {
    //console.warn('resetTimer');
    clearTimeout(timeoutHandle);
    idleSince = Date.now();
    timeoutHandle = setTimeout(idleCallback, 10000);  // time is in milliseconds
  }
}

{
  //<editor-fold desc="Constant declarations">
  //https://fonts.google.com/icons?icon.style=Rounded&icon.query=minimize
  const GOOGLE_ICON_FONTS_URL = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@48,400,0,0';
  const DEBUG_MODE_URL_QUERY_PARAMETER = 'debug';
  const ENVIRONMENT_URL_QUERY_PARAMETER = 'env';
  const ENV_PROD = 'prod';
  const ENV_STAGING = 'staging';
  const ENV_LOCAL = 'local';
  const ENV_PREPROD = 'preprod'
  const {chatJsUrl, environment, inDebugMode, lang, tenantId } = extractSearchParamsInSrc();
  const LOCAL_STORAGE_KEY_DISMISS_PROMPT = 'grispi.chat.dismissPrompt';
  const LOCAL_STORAGE_KEY_CHAT_ID = 'grispi.chat.chatId';
  const LOCAL_STORAGE_KEY_LAST_MESSAGE_TIME = 'grispi.chat.lastMessageTime';

  const INCOMING_EVENTS = {
    READY: 'grispi.chat.request.ready',
    NEW_CHAT_SESSION: 'grispi.chat.request.newChatSession',
    LAST_MESSAGE_TIME: 'grispi.chat.request.lastMessageTime',
    UNSEEN_MESSAGES_COUNT: 'grispi.chat.request.unseenMessageCount',
    CLOSE_POPUP: 'grispi.chat.request.closePopup',
    RESET_CHAT: 'grispi.chat.request.resetChat',
  };

  const OUTGOING_EVENTS = {
    INIT: 'grispi.chat.response.init',
    POPUP_CLOSED: 'grispi.chat.event.popupClosed',
    POPUP_OPENED: 'grispi.chat.event.popupOpened',
    USER_WANTS_TO_END_CHAT: 'grispi.chat.event.userWantsToEndChat',
  };

  const GRISPI_API_URL = grispiApiUrl(environment);
  const CHAT_POPUP_URL = chatPopupIframeUrl(environment);

  /**
   * The customer's own site url (3rd party website). The one that the end user browses.
   */
  const HOST_URL = location.href;

  const authKey = uuidv4();
  const iframeUrlDebugParam = inDebugMode ? '&debug=true' : '';
  const iframeUrl = `${CHAT_POPUP_URL}?url=${HOST_URL}&auth=${authKey}&lang=${lang}${iframeUrlDebugParam}`;
  //</editor-fold>

  //<editor-fold desc="init()">
  function init() {

    if (document.getElementById('GrispiChat')) {
      const errorMsg = `There's already an element with id "GrispiChat". Ensure that you only include "chat.js" once.`;
      console.error(errorMsg);
      inDebugMode && alert(errorMsg);
      return;
    }

    document.body.insertAdjacentHTML('beforeend', `<section id="GrispiChat"></section>`);

    // Fonts are not downloaded when they're only in shadow dom, they need to be in both sides, the main dom and the shadow dom:
    // Thanks: https://stackoverflow.com/a/57623658/878361
    document.body.insertAdjacentHTML('beforeend', `<link rel="stylesheet" href="${GOOGLE_ICON_FONTS_URL}" />`);
    const shadowDom = document.getElementById('GrispiChat').attachShadow({ mode: "open" });

    const showPrompt = localStorage.getItem(LOCAL_STORAGE_KEY_DISMISS_PROMPT) !== 'true';
    shadowDom.innerHTML = htmlTemplate(iframeUrl);

    const iframe = shadowDom.getElementById('chatIframe');
    const popup = shadowDom.getElementById('popup');
    const headerTitleElem = shadowDom.getElementById('chatTitle');
    const closeBtn = shadowDom.getElementById('popupCloseBtn');
    const minimizeBtn = shadowDom.getElementById('popupMinimizeBtn');
    const startBtn = shadowDom.getElementById('startBtn');
    const unreadCount = shadowDom.getElementById('messageCount');
    const chatPrompt = shadowDom.getElementById('chatPrompt');
    const promptHideBtn = shadowDom.getElementById('chatPromptHide');
    const startWarningIcon = shadowDom.getElementById('startWarningIcon');

    minimizeBtn.onclick = () => {
      popup.style.display = 'none';
      startBtn.style.display = 'flex';
      iframe.contentWindow.postMessage({type: OUTGOING_EVENTS.POPUP_CLOSED, auth: authKey}, CHAT_POPUP_URL);
    };
    closeBtn.onclick = () => {
      iframe.contentWindow.postMessage({type: OUTGOING_EVENTS.USER_WANTS_TO_END_CHAT, auth: authKey}, CHAT_POPUP_URL);
    };
    startBtn.onclick = () => {
      popup.style.display = 'flex';
      startBtn.style.display = 'none';
      iframe.contentWindow.postMessage({type: OUTGOING_EVENTS.POPUP_OPENED, auth: authKey}, CHAT_POPUP_URL);
    };
    startBtn.showWarningSign = function () {
      startBtn.classList.add('show-warn');
    }
    startBtn.updateMessageCount = function (messageCount) {
      if (messageCount > 0) {
        unreadCount.innerText = messageCount;
        startBtn.classList.add('show-count');
      } else {
        unreadCount.innerText = '';
        startBtn.classList.remove('show-count');
      }
    }

    chatPrompt.show = () => {
      startBtn.classList.add('show-prompt');
    }

    chatPrompt.hide = () => {
      startBtn.classList.remove('show-prompt');
    }

    promptHideBtn.onclick = e => {
      chatPrompt.hide();
      localStorage.setItem(LOCAL_STORAGE_KEY_DISMISS_PROMPT, 'true');
      e.cancelBubble = true;
    };

    // listen for ready message then send init message when preferences promise is fulfilled
    window.addEventListener('message', (event) => {

      const {auth, data, type} = event.data;
      debug('Incoming event', type, auth, data);
      if (auth !== authKey) {
        console.error('Window is not authenticated!');
        return;
      }
      if (type === INCOMING_EVENTS.READY) {
        fetch(`${GRISPI_API_URL}/chat/preferences`, {
          method: 'GET', mode: 'cors', headers: {
            tenantId: tenantId
          }
        })
          .then((response) => {
            if (!response.ok) {
              // get error message from body or default to response status
              const error = `${response.status} ${response.statusText}`;
              return Promise.reject(error);
            }
            return response.json();
          })
          .then(async (parsedPreferences) => {
            headerTitleElem.innerText = parsedPreferences?.text?.title;
            if (showPrompt) {
              chatPrompt.show();
              chatPrompt.querySelector('#chatPromptText').innerText = parsedPreferences.text?.prompt;
            }
            const initMessage = {
              type: OUTGOING_EVENTS.INIT, auth: authKey, data: {
                lastMessageTime: defaultIfNullish(window.localStorage.getItem(LOCAL_STORAGE_KEY_LAST_MESSAGE_TIME)),
                tenantId: tenantId,
                chatId: defaultIfNullish(window.localStorage.getItem(LOCAL_STORAGE_KEY_CHAT_ID)),
                preferences: parsedPreferences,
                online: await onlineStatus()
              }
            };

            debug('Sending initMessage', initMessage);
            event.source.postMessage(initMessage, CHAT_POPUP_URL);
          })
          .catch(error => {
            startBtn.showWarningSign();
            console.error('An error occurred while fetching preferences!', error);
            iframe.src = new URL(`config-error.html?msg=${'An error occurred while fetching preferences! ' + error}`, chatJsUrl);
            headerTitleElem.innerText = 'Grispi sohbet';//i18n
          });
      } else if (type === INCOMING_EVENTS.NEW_CHAT_SESSION) {
        window.localStorage.setItem(LOCAL_STORAGE_KEY_CHAT_ID, data.chatId);
      } else if (type === INCOMING_EVENTS.LAST_MESSAGE_TIME) {
        window.localStorage.setItem(LOCAL_STORAGE_KEY_LAST_MESSAGE_TIME, data.lastMessageTime);
      } else if (type === INCOMING_EVENTS.UNSEEN_MESSAGES_COUNT) {
        startBtn.updateMessageCount(data.count);
      } else if (type === INCOMING_EVENTS.CLOSE_POPUP) {
        minimizeBtn.onclick();
      } else if (type === INCOMING_EVENTS.RESET_CHAT) {
        localStorage.removeItem(LOCAL_STORAGE_KEY_LAST_MESSAGE_TIME);
        localStorage.removeItem(LOCAL_STORAGE_KEY_CHAT_ID);
        const iframeSrc = iframe.src;
        iframe.src = '';
        iframe.src = iframeSrc;
      }
    });

  }
  //</editor-fold>

  if (document.readyState === 'loading') {  // Loading hasn't finished yet
    typeof window === 'object' && window.addEventListener('DOMContentLoaded', init);
  } else {  // `DOMContentLoaded` has already fired
    init();
  }

  //<editor-fold desc="Utility functions">
  function parseEnv(env) {
    if (!env || env.trim().length === 0) return ENV_PROD;
    if (env.toLowerCase() === ENV_PREPROD) return ENV_PREPROD;
    if (env.toLowerCase() === ENV_STAGING) return ENV_STAGING;
    if (env.toLowerCase() === ENV_LOCAL) return ENV_LOCAL;
  }

  function extractSearchParamsInSrc() {
    if (!document.currentScript || !document.currentScript.src) {
      console.error(`'document.currentScript' is not available!`);
      return {};
    }

    const searchParams = new URL(document.currentScript?.src).searchParams;

    const debugModeParam = searchParams.get(DEBUG_MODE_URL_QUERY_PARAMETER) || '';
    return {
      chatJsUrl: document.currentScript.src,
      environment: parseEnv(searchParams.get(ENVIRONMENT_URL_QUERY_PARAMETER)),
      inDebugMode: debugModeParam.toLowerCase() === 'true',
      tenantId: searchParams.get('tenantId'),
      lang: searchParams.get('lang') ?? (navigator.language.startsWith('tr') ? 'tr' : 'en'),
    };
  }

  const onlineStatus = async () => {
    const response = await fetch(`${GRISPI_API_URL}/chat/status`, {
      method: 'GET', mode: 'cors', headers: {
        tenantId: tenantId
      }
    });
    return await response.json();
  };

  function uuidv4() {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
  }

  function grispiApiUrl(env) {
    switch (env) {
      case ENV_LOCAL:
        return 'http://localhost:8080';
      case ENV_STAGING:
        return 'https://api.grispi.dev';
      case ENV_PROD:
        return 'https://api.grispi.com';
      case ENV_PREPROD:
        return 'https://api.grispi.net';
    }
  }

  function chatPopupIframeUrl(env) {
    switch (env) {
      case ENV_LOCAL:
        return 'http://localhost:3000';
      case ENV_STAGING:
        return 'https://chat-ui.grispi.dev';
      case ENV_PROD:
        return 'https://chat-ui.grispi.com';
      case ENV_PREPROD:
        return 'https://chat-ui.grispi.net';
    }
  }
  //</editor-fold>

  //<editor-fold desc="htmlTemplate">
  function htmlTemplate(src) {
    return `
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="${GOOGLE_ICON_FONTS_URL}" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/modern-normalize/1.1.0/modern-normalize.min.css" integrity="sha512-wpPYUAdjBVSE4KJnH1VR1HeZfpl1ub8YT/NKx4PuQ5NmX2tKuGu6U/JRp5y+Y8XG2tV+wKQpNHVUX03MfMFn9Q==" crossorigin="anonymous" referrerpolicy="no-referrer" />
  <style>
    .material-symbols-rounded {
      font-variation-settings:
          'FILL' 1,
          'wght' 400,
          'GRAD' 0,
          'opsz' 48
    }
    #popup {
      border-radius: 15px;
      border: 0;
      bottom: 10px;
      box-shadow: 2px 10px 31px 0 rgba(0,0,0,0.33);
      display: none;
      flex-direction: column;
      height: 650px;
      max-height: calc(100vh - 10px);
      position: fixed;
      right: 10px;
      width: 400px;
      z-index: 2147483645;
    }
    @media (max-width: 450px) {
      #popup {
        height: auto;
        left: 10px;
        top: 10px;
        width: auto;
      }
    }
    @media (max-width: 350px) {
      #chatPrompt {
        visibility: hidden;
      }
    }
    #popupHeader {
      align-content: center;justify-content: center;align-items: stretch;
      background-color: #632d91;
      border-top-left-radius: 15px;
      border-top-right-radius: 15px;
      display: flex;
      flex-grow: 0;
      height: 50px;
    }
    #chatTitle{
      align-items: center;
      color:#f8f9f9;
      display: flex;
      flex-grow: 1;
      font-family: sans-serif;
      font-size: 19px;
      font-weight: normal;
      padding-left: 10px;
    }
    #popupMinimizeBtn, #popupCloseBtn{
      background-color: transparent;
      border: 0 solid #3498db;
      color: #f8f9f9;
      cursor: pointer;
      height: 50px;
      padding-right:10px
    }
    #popupMinimizeBtn:hover, #popupCloseBtn:hover{
      color: #ccc;
    }
    #chatIframe{
      border-bottom-left-radius: 15px;
      border-bottom-right-radius: 15px;
      border: none;
      flex-grow: 2;
    }

    #startBtn {
      align-items: center;
      background-color: #632d91;
      border-radius: 50%;
      border: 0;
      bottom: 20px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      font-weight: normal;
      height: 80px;
      justify-content: center;
      position: fixed;
      right: 20px;
      width: 80px;
      z-index: 2147483644;
    }
    #startWarningIcon{
      color: orangered;
      display: none;
      left: -6px;
      position: absolute;
      top: -12px;
      font-size: 2rem;
    }
    .show-warn #startWarningIcon {
      display: block;
    }
    #startIcon{
      color: white;
      font-size: 40px;
    }
    .show-prompt #startIcon {
      margin-top: -50px;
    }
    #messageCount{
      background-color: orangered;
      border-radius: 15px;
      bottom: -8px;
      color: white;
      display: none;
      font-family: sans-serif;
      font-size: 16px;
      font-weight: bold;
      height: 30px;
      left: 0;
      line-height: 30px;
      position: absolute;
      text-align: center;
      width: 30px;
    }
    .show-count #messageCount {
      display: inline;
    }
    #chatPrompt{
      align-items: center;
      background-color: white;
      border-radius: 18px;
      border: 1px solid lightgrey;
      color: #595959;
      display: none;
      font-family: sans-serif;
      font-size: 17px;
      font-weight: normal;
      height: 40px;
      line-height: 26px;
      margin-left: -305px;
      margin-top: 10px;
      padding: 0 10px;
    }
    .show-prompt #chatPrompt {
      display: flex;
    }
    #chatPromptText {
    flex-grow: 1;
    }
    #chatPromptHide{
      line-height: 36px;
      vertical-align: middle;
    }
    #chatPromptHide:hover{
      background-color: #eee;
      border-radius: 20px;
    }
  </style>
</head>
<body>
<section id="popup">
  <div id="popupHeader">
    <span id="chatTitle">Grispi sohbet</span>
    <button id="popupMinimizeBtn">
      <span class="material-symbols-rounded">minimize</span>
    </button>
    <button id="popupCloseBtn">
      <span class="material-symbols-rounded">close</span>
    </button>
  </div>
  <iframe id="chatIframe" src="${src}" referrerpolicy="origin"></iframe>
</section>

<section id="startBtn">
  <span id="startWarningIcon" class="material-symbols-rounded"> warning </span>
  <span id="chatPrompt">
    <span id="chatPromptText"></span>
    <span id="chatPromptHide" class="material-symbols-rounded">close</span>
  </span>
  <span id="startIcon" class="material-symbols-rounded">chat</span>
  <span id="messageCount"></span>
</section>
</body>
`;//return
  }//htmlTemplate
  //</editor-fold>

  function debug(...args) {
    if (inDebugMode) {
      console.log('chat.js', ...args);
    }
  }

  function defaultIfNullish(value, defaultValue) {
    if ('undefined' === value || 'null' === value) return defaultValue;
    return value ?? defaultValue;
  }
}
