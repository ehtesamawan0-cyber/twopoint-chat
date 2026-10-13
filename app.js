const cfg = window.APP_CONFIG || {};
const authView = document.querySelector("#authView");
const chatView = document.querySelector("#chatView");
const loginForm = document.querySelector("#loginForm");
const loginButton = document.querySelector("#loginButton");
const pinInput = document.querySelector("#pin");
const authError = document.querySelector("#authError");
const messageList = document.querySelector("#messageList");
const emptyState = document.querySelector("#emptyState");
const composer = document.querySelector("#composer");
const messageInput = document.querySelector("#messageInput");
const sendButton = document.querySelector("#sendButton");
const logoutButton = document.querySelector("#logoutButton");
const clearButton = document.querySelector("#clearButton");
const connectionStatus = document.querySelector("#connectionStatus");
const notice = document.querySelector("#notice");
const globalToast = document.querySelector("#globalToast");

let supabase = null;
let currentUser = null;
let channel = null;
let messages = [];
let seenIds = new Set();
let toastTimer = null;
let sending = false;

function showToast(text) {
  globalToast.textContent = text;
  globalToast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => globalToast.classList.add("hidden"), 2800);
}
function setStatus(state, label) {
  connectionStatus.className = `status ${state}`;
  connectionStatus.replaceChildren();
  const dot = document.createElement("i");
  connectionStatus.append(dot, document.createTextNode(` ${label}`));
}
function showAuth() {
  authView.classList.remove("hidden");
  chatView.classList.add("hidden");
  authError.textContent = "";
  pinInput.value = "";
}
function showChat() {
  authView.classList.add("hidden");
  chatView.classList.remove("hidden");
}
function clearRenderedMessages() {
  messages = [];
  seenIds.clear();
  messageList.replaceChildren();
  messageList.append(emptyState);
  emptyState.classList.remove("hidden");
}
function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
function renderMessage(message) {
  if (!message || !message.id || seenIds.has(String(message.id))) return;
  seenIds.add(String(message.id));
  messages.push(message);
  emptyState.classList.add("hidden");
  const row = document.createElement("article");
  row.className = `message-row${message.sender_id === currentUser.id ? " mine" : ""}`;
  row.dataset.messageId = message.id;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = message.body;
  const meta = document.createElement("p");
  meta.className = "message-meta";
  meta.textContent = formatTime(message.created_at);
  row.append(bubble, meta);
  messageList.append(row);
  messageList.scrollTop = messageList.scrollHeight;
}
async function loadMessages() {
  if (!supabase || !currentUser) return;
  const { data, error } = await supabase
    .from("messages")
    .select("id, sender_id, body, created_at, expires_at")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  clearRenderedMessages();
  for (const message of data || []) renderMessage(message);
}
async function subscribeRealtime() {
  if (channel) await supabase.removeChannel(channel);
  channel = supabase.channel("private-chat-messages")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, payload => {
      if (currentUser && payload.new && new Date(payload.new.expires_at) > new Date()) renderMessage(payload.new);
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, () => {
      loadMessages().catch(() => clearRenderedMessages());
    })
    .subscribe(status => {
      if (status === "SUBSCRIBED") setStatus("online", "Connected");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setStatus("offline", "Reconnecting");
      else setStatus("", "Connecting");
    });
}
async function enterChat(user) {
  currentUser = user;
  showChat();
  setStatus("", "Connecting");
  notice.classList.add("hidden");
  clearRenderedMessages();
  try {
    await loadMessages();
    await subscribeRealtime();
  } catch (error) {
    notice.textContent = "Could not load messages. Check your connection and Supabase setup.";
    notice.classList.remove("hidden");
    setStatus("offline", "Unavailable");
    console.error("Initial chat load failed:", error);
  }
}
async function leaveChat({ signOut = false } = {}) {
  clearRenderedMessages();
  if (channel && supabase) {
    await supabase.removeChannel(channel);
    channel = null;
  }
  currentUser = null;
  if (signOut && supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) showToast("Could not fully sign out. Try again.");
  }
  showAuth();
}
function clearChatUIOnHide() {
  clearRenderedMessages();
}
async function initialize() {
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY ||
      cfg.SUPABASE_URL.includes("YOUR_PROJECT_ID") ||
      cfg.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")) {
    authError.textContent = "Setup required: add your Supabase URL and publishable key to config.js.";
    loginButton.disabled = true;
    return;
  }
  if (!window.supabase?.createClient) {
    authError.textContent = "Supabase client did not load. Check your internet connection and reload.";
    loginButton.disabled = true;
    return;
  }
  supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 5 } }
  });
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) console.error(error);
  if (session?.user) await enterChat(session.user);
  supabase.auth.onAuthStateChange((event, sessionNow) => {
    if (event === "SIGNED_OUT") {
      currentUser = null;
      clearRenderedMessages();
      showAuth();
    } else if (event === "SIGNED_IN" && sessionNow?.user && !currentUser) {
      setTimeout(() => enterChat(sessionNow.user), 0);
    }
  });
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!supabase) return;
  const pin = pinInput.value.trim();
  if (pin.length < 6) {
    authError.textContent = "Your PIN must be at least 6 characters.";
    return;
  }
  authError.textContent = "";
  loginButton.disabled = true;
  loginButton.textContent = "Verifying PIN…";
  try {
    const { data, error } = await supabase.functions.invoke("pin-login", { body: { pin } });
    if (error) throw error;
    if (!data?.access_token || !data?.refresh_token) throw new Error("Login service returned no session.");
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token
    });
    if (sessionError) throw sessionError;
    if (!sessionData.user) throw new Error("No authenticated user returned.");
    pinInput.value = "";
    await enterChat(sessionData.user);
  } catch (error) {
    authError.textContent = "PIN not accepted or login service is not configured yet. Try again later.";
    console.error("PIN login failed:", error);
  } finally {
    loginButton.disabled = false;
    loginButton.innerHTML = 'Unlock private space <span aria-hidden="true">↗</span>';
    pinInput.value = "";
  }
});

messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 130)}px`;
  sendButton.disabled = !messageInput.value.trim() || sending;
});
messageInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    composer.requestSubmit();
  }
});
composer.addEventListener("submit", async event => {
  event.preventDefault();
  const body = messageInput.value.trim();
  if (!body || !currentUser || !supabase || sending) return;
  if (body.length > 2000) return showToast("Message is too long.");
  sending = true;
  sendButton.disabled = true;
  try {
    const { error } = await supabase.from("messages").insert({ sender_id: currentUser.id, body });
    if (error) throw error;
    messageInput.value = "";
    messageInput.style.height = "auto";
  } catch (error) {
    showToast("Message could not be sent. Please try again.");
    console.error("Send failed:", error);
  } finally {
    sending = false;
    sendButton.disabled = !messageInput.value.trim();
    messageInput.focus();
  }
});
clearButton.addEventListener("click", async () => {
  if (!supabase || !currentUser) return;
  const confirmed = window.confirm("Delete all messages for both people? This cannot be undone.");
  if (!confirmed) return;
  clearButton.disabled = true;
  try {
    const { error } = await supabase.from("messages").delete().not("id", "is", null);
    if (error) throw error;
    clearRenderedMessages();
    showToast("Conversation cleared.");
  } catch (error) {
    showToast("Could not clear the conversation.");
    console.error("Clear failed:", error);
  } finally {
    clearButton.disabled = false;
  }
});
logoutButton.addEventListener("click", async () => leaveChat({ signOut: true }));
window.addEventListener("pagehide", clearChatUIOnHide);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") clearChatUIOnHide();
  else if (document.visibilityState === "visible" && currentUser && supabase) {
    loadMessages().catch(error => console.error("Resume load failed:", error));
  }
});
window.addEventListener("online", () => {
  if (currentUser) {
    showToast("Connection restored.");
    loadMessages().catch(() => {});
    subscribeRealtime().catch(() => {});
  }
});
window.addEventListener("offline", () => setStatus("offline", "Offline"));
initialize().catch(error => {
  authError.textContent = "The app could not initialize. Check configuration and reload.";
  console.error("Initialization failed:", error);
});
