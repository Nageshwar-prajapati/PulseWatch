const checkButton = document.querySelector(".checkButton");
const urlInput = document.querySelector(".input-container input");
const result = document.getElementById("result");

PW.setupNav().catch(function () {});

urlInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") checkButton.click();
});

checkButton.addEventListener("click", async function () {
    let url = urlInput.value.trim();
    result.innerHTML = "";

    if (url === "") {
        result.innerHTML = `<p class="error">Please enter a website URL.</p>`;
        return;
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://" + url;
    try {
        const u = new URL(url);
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
        url = u.href;
    } catch (error) {
        result.innerHTML = `<p class="error">Please enter a valid URL.<br>Example: https://example.com</p>`;
        return;
    }

    checkButton.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Checking...`;
    checkButton.disabled = true;
    result.innerHTML = `<p class="checking">Sending request to <strong>${PW.escapeHtml(url)}</strong>...</p>`;

    try {
        // The backend sends the request signal to the site and reports Up/Down.
        const data = await PW.api("/api/monitors", { method: "POST", body: { url: url, allowExisting: true } });
        const m = data.monitor;
        const code = m.statusCode ? "HTTP " + m.statusCode + " · " : "";
        if (m.status === "Online") {
            result.innerHTML = `
                <div class="success">
                    <i class="fa-solid fa-circle-check"></i>
                    <div>
                        <strong>Website is UP</strong>
                        <p>${PW.escapeHtml(m.url)}</p>
                        <p>${code}${m.responseTime} ms</p>
                    </div>
                </div>`;
        } else {
            result.innerHTML = `
                <div class="error-box">
                    <i class="fa-solid fa-circle-xmark"></i>
                    <div>
                        <strong>Website is DOWN</strong>
                        <p>${PW.escapeHtml(m.url)}</p>
                        <p>${code}${m.responseTime} ms</p>
                    </div>
                </div>`;
        }
        setTimeout(function () { window.location.href = "dashboard.html"; }, 1800);
    } catch (error) {
        result.innerHTML = `<p class="error">${PW.escapeHtml(error.message)}</p>`;
    }

    checkButton.innerHTML = "Check";
    checkButton.disabled = false;
});
