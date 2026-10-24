const form = document.getElementById("authForm");
const formTitle = document.getElementById("formTitle");
const formMessage = document.getElementById("formMessage");
const usernameInput = document.getElementById("username");
const userLabel = document.getElementById("userLabel");
const emailGroup = document.getElementById("emailGroup");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const rememberInput = document.getElementById("remember");
const submitBtn = document.getElementById("submitBtn");
const switchText = document.getElementById("switchText");
const switchLink = document.getElementById("switchLink");
const passwordEye = document.querySelector(".password-eye");

let mode = "login";
const next = new URLSearchParams(location.search).get("next") || "dashboard.html";

PW.setupNav().then(function (user) {
    if (user) showMessage("You are logged in as " + user.username + ". Use Profile > Logout to switch accounts.", "success");
}).catch(function () {});

function showMessage(text, type) {
    formMessage.textContent = text;
    formMessage.className = "form-message " + (type || "");
}

function setMode(newMode) {
    mode = newMode;
    const signup = mode === "signup";
    formTitle.textContent = signup ? "Create your account" : "Welcome back";
    userLabel.textContent = signup ? "Username" : "Email / Username";
    usernameInput.placeholder = signup ? "Choose a username" : "Enter your email or username";
    emailGroup.hidden = !signup;
    passwordInput.autocomplete = signup ? "new-password" : "current-password";
    submitBtn.textContent = signup ? "Sign Up" : "Login";
    switchText.textContent = signup ? "Already have an account?" : "Don't have an account?";
    switchLink.textContent = signup ? "Login" : "Sign Up";
    showMessage("");
}

if (new URLSearchParams(location.search).get("mode") === "signup") setMode("signup");

switchLink.addEventListener("click", function (e) {
    e.preventDefault();
    setMode(mode === "login" ? "signup" : "login");
});

document.getElementById("forgotLink").addEventListener("click", function (e) {
    e.preventDefault();
    showMessage("Password reset is not set up yet. Please create a new account or contact your admin.", "error");
});

passwordEye.addEventListener("click", function () {
    const hidden = passwordInput.type === "password";
    passwordInput.type = hidden ? "text" : "password";
    passwordEye.classList.toggle("fa-eye", !hidden);
    passwordEye.classList.toggle("fa-eye-slash", hidden);
});

form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const body = {
        username: usernameInput.value.trim(),
        password: passwordInput.value,
        remember: rememberInput.checked
    };
    if (!body.username || !body.password) {
        showMessage("Please fill in all required fields.", "error");
        return;
    }
    if (mode === "signup") body.email = emailInput.value.trim();

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
        await PW.api(mode === "signup" ? "/api/signup" : "/api/login", { method: "POST", body: body });
        showMessage(mode === "signup" ? "Account created! Redirecting..." : "Login successful! Redirecting...", "success");
        setTimeout(function () { location.href = next; }, 600);
    } catch (err) {
        showMessage(err.message, "error");
        submitBtn.disabled = false;
        submitBtn.textContent = mode === "signup" ? "Sign Up" : "Login";
    }
});
