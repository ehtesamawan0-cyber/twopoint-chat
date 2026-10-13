const cfg = window.APP_CONFIG || {};
const authView = document.querySelector("#authView");
const chatView = document.querySelector("#chatView");
const loginForm = document.querySelector("#loginForm");
const loginButton = document.querySelector("#loginButton");
const authError = document.querySelector("#authError");
const forgotPasswordButton = document.querySelector("#forgotPasswordButton");
const resetView = document.querySelector("#resetView");
const resetRequestForm = document.querySelector("#resetRequestForm");
const resetPasswordForm = document.querySelector("#resetPasswordForm");
const resetEmail = document.querySelector("#resetEmail");
const sendResetButton = document.querySelector("#sendResetButton");
const resetRequestMessage = document.querySelector("#resetRequestMessage");
const backToLoginButton = document.querySelector("#backToLoginButton");
const newPassword = document.querySelector("#newPassword");
const confirmPassword = document.querySelector("#confirmPassword");
const updatePasswordButton = document.querySelector("#updatePasswordButton");
const resetPasswordMessage = document.querySelector("#resetPasswordMessage");
const resetDescription = document.querySelector("#resetDescription");
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
let recoveryMode = false;

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
}
function showChat() {
  authView.classList.add("hidden");
  chatView.classList.remove("hidden");
}
function showResetRequest() {
  recoveryMode = false;
  authView.classList.add("hidden");
  chatView.classList.add("hidden");
  resetView.classList.remove("hidden");
  resetRequestForm.classList.remove("hidden");
  resetPasswordForm.classList.add("hidden");
  resetRequestMessage.textContent = "";
  resetPasswordMessage.textContent = "";
  resetDescription.textContent = "Enter your account email and we'll send you a secure reset link.";
  resetEmail.value = document.querySelector("#email").value.trim();
}
function showResetPassword() {
  recoveryMode = true;
  authView.classList.add("hidden");
  chatView.classList.add("hidden");
  resetView.classList.remove("hidden");
  resetRequestForm.classList.add("hidden");
  resetPasswordForm.classList.remove("hidden");
  resetRequestMessage.textContent = "";
  resetPasswordMessage.textContent = "";
  resetDescription.textContent = "Choose a new password for your account.";
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
      if (currentUser && payload.new && new Date(payload.new.expires_at) > new Date()) {
        renderMessage(payload.new);
      }
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
  // Best effort only: browsers do not guarantee lifecycle events on force-close.
  clearRenderedMessages();
}
async function initialize() {
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY ||
      cfg.SUPABASE_URL.includes("YOUR_PROJECT_ID") ||
      cfg.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")) {
    authError.textContent = "Setup required: copy config.js.example to config.js and add your Supabase URL and public key.";
    loginButton.disabled = true;
    return;
  }
  if (!window.supabase?.createClient) {
    authError.textContent = "Supabase client did not load. Check your internet connection and reload.";
    loginButton.disabled = true;
    return;
  }
  supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    realtime: { params: { eventsPerSecond: 5 } }
  });
  const recoveryLink = new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery";
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) console.error(error);
  if (recoveryLink) {
    showResetPassword();
  } else if (session?.user) {
    await enterChat(session.user);
  }

  supabase.auth.onAuthStateChange((event, sessionNow) => {
    if (event === "PASSWORD_RECOVERY") {
      showResetPassword();
    } else if (event === "SIGNED_OUT") {
      currentUser = null;
      clearRenderedMessages();
      showAuth();
    } else if (event === "SIGNED_IN" && sessionNow?.user && !currentUser && !recoveryMode) {
      setTimeout(() => enterChat(sessionNow.user), 0);
    }
  });
}
loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!supabase) return;
  authError.textContent = "";
  loginButton.disabled = true;
  loginButton.textContent = "Signing in…";
  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (data.user) await enterChat(data.user);
  } catch (error) {
    authError.textContent = "Sign-in failed. Check your details or account access.";
    console.error("Sign-in failed:", error);
  } finally {
    loginButton.disabled = false;
    loginButton.innerHTML = 'Continue <span aria-hidden="true">↗</span>';
  }
});
forgotPasswordButton.addEventListener("click", showResetRequest);
backToLoginButton.addEventListener("click", showAuth);

resetRequestForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!supabase) return;
  resetRequestMessage.textContent = "";
  sendResetButton.disabled = true;
  sendResetButton.textContent = "Sending…";
  try {
    const email = resetEmail.value.trim();
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    resetRequestMessage.textContent = "If this email belongs to an account, a reset link has been sent. Check your inbox and spam folder.";
  } catch (error) {
    resetRequestMessage.textContent = "Could not send the reset email. Check the Supabase URL settings and try again.";
    console.error("Password reset request failed:", error);
  } finally {
    sendResetButton.disabled = false;
    sendResetButton.innerHTML = 'Send reset link <span aria-hidden="true">↗</span>';
  }
});

resetPasswordForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!supabase) return;
  resetPasswordMessage.textContent = "";
  const passwordValue = newPassword.value;
  if (passwordValue !== confirmPassword.value) {
    resetPasswordMessage.textContent = "The passwords do not match.";
    confirmPassword.focus();
    return;
  }
  if (passwordValue.length < 8) {
    resetPasswordMessage.textContent = "Use at least 8 characters.";
    newPassword.focus();
    return;
  }
  updatePasswordButton.disabled = true;
  updatePasswordButton.textContent = "Updating…";
  try {
    const { error } = await supabase.auth.updateUser({ password: passwordValue });
    if (error) throw error;
    await supabase.auth.signOut();
    recoveryMode = false;
    window.history.replaceState({}, document.title, window.location.pathname);
    resetPasswordForm.reset();
    showAuth();
    authError.textContent = "Password updated. Sign in with your new password.";
  } catch (error) {
    resetPasswordMessage.textContent = "Password could not be updated. Request a fresh reset link and try again.";
    console.error("Password update failed:", error);
  } finally {
    updatePasswordButton.disabled = false;
    updatePasswordButton.innerHTML = 'Update password <span aria-hidden="true">↗</span>';
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
