let currentThreadId = localStorage.getItem("travel_thread_id") || null;
let latestAnswerMarkdown = "";
let waitingForApproval = false;

const AGENT_LABELS = {
  flight_agent: "✈️ Flight Agent",
  hotel_agent: "🏨 Hotel Agent",
  weather_agent: "🌦️ Weather Agent",
  budget_agent: "💰 Budget Agent",
  itinerary_agent: "🗓️ Itinerary Agent"
};

function setPrompt(text) {
  document.getElementById("userInput").value = text;
}

function setLoading(isLoading, mode = "draft") {
  const sendBtn = document.getElementById("sendBtn");
  const btnText = document.getElementById("btnText");
  const btnLoader = document.getElementById("btnLoader");
  const approveBtn = document.getElementById("approveBtn");
  const reviseBtn = document.getElementById("reviseBtn");

  sendBtn.disabled = isLoading;
  approveBtn.disabled = isLoading;
  reviseBtn.disabled = isLoading;

  if (isLoading && mode === "draft") {
    btnText.classList.add("hidden");
    btnLoader.classList.remove("hidden");
  } else {
    btnText.classList.remove("hidden");
    btnLoader.classList.add("hidden");
  }
}

function showError(message) {
  const errorBox = document.getElementById("errorBox");
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
  errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideError() {
  const errorBox = document.getElementById("errorBox");
  errorBox.classList.add("hidden");
  errorBox.textContent = "";
}

function renderMarkdown(element, markdown) {
  if (typeof marked !== "undefined") {
    element.innerHTML = marked.parse(markdown || "");
  } else {
    element.innerText = markdown || "";
  }
}

function showWorkflow(data) {
  const section = document.getElementById("workflowSection");
  const reasoning = document.getElementById("supervisorReasoning");
  const chips = document.getElementById("agentChips");
  const guardrailBadge = document.getElementById("guardrailBadge");

  reasoning.textContent = data.supervisor_reasoning || "Supervisor routing completed.";
  chips.innerHTML = "";

  (data.selected_agents || []).forEach((agent) => {
    const chip = document.createElement("span");
    chip.className = "agent-chip";
    chip.textContent = AGENT_LABELS[agent] || agent;
    chips.appendChild(chip);
  });

  if (data.guardrail_allowed === false) {
    guardrailBadge.textContent = "Guardrail blocked";
    guardrailBadge.classList.add("blocked");
  } else {
    guardrailBadge.textContent = "Guardrail passed";
    guardrailBadge.classList.remove("blocked");
  }

  section.classList.remove("hidden");
}

function showResult(answer, threadId, isDraft = false) {
  latestAnswerMarkdown = answer || "";

  const resultSection = document.getElementById("resultSection");
  const resultBox = document.getElementById("resultBox");
  const threadInfo = document.getElementById("threadInfo");
  const resultTitle = document.getElementById("resultTitle");

  renderMarkdown(resultBox, latestAnswerMarkdown);
  threadInfo.textContent = `Thread ID: ${threadId}`;
  resultTitle.textContent = isDraft ? "Draft Travel Plan" : "Your Final AI Travel Plan";
  resultSection.classList.remove("hidden");

  resultSection.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function showApproval(data) {
  waitingForApproval = true;
  const section = document.getElementById("approvalSection");
  const approvalRequest = document.getElementById("approvalRequest");
  approvalRequest.textContent = data.approval_request ||
    "Approve the draft or provide feedback before the final plan is generated.";
  section.classList.remove("hidden");
}

function hideApproval() {
  waitingForApproval = false;
  document.getElementById("approvalSection").classList.add("hidden");
  document.getElementById("approvalFeedback").value = "";
}

async function sendMessage() {
  hideError();

  if (waitingForApproval) {
    showError("Please approve or revise the current draft before starting another plan.");
    return;
  }

  const input = document.getElementById("userInput");
  const message = input.value.trim();

  if (!message) {
    showError("Please enter your travel request first.");
    return;
  }

  setLoading(true, "draft");

  try {
    const response = await fetch("/api/travel", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: message,
        thread_id: currentThreadId
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Something went wrong.");
    }

    currentThreadId = data.thread_id;
    localStorage.setItem("travel_thread_id", currentThreadId);

    showWorkflow(data);

    if (data.requires_approval) {
      showResult(data.itinerary || data.answer, data.thread_id, true);
      showApproval(data);
    } else {
      hideApproval();
      showResult(data.answer, data.thread_id, false);
    }
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false, "draft");
  }
}

async function submitApproval(approved) {
  hideError();

  if (!currentThreadId || !waitingForApproval) {
    showError("There is no draft waiting for approval.");
    return;
  }

  const feedbackInput = document.getElementById("approvalFeedback");
  const feedback = feedbackInput.value.trim();

  if (!approved && !feedback) {
    showError("Please enter revision feedback before requesting changes.");
    feedbackInput.focus();
    return;
  }

  setLoading(true, "approval");

  try {
    const response = await fetch("/api/travel/approve", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        thread_id: currentThreadId,
        approved: approved,
        feedback: feedback
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Could not resume the travel workflow.");
    }

    showWorkflow(data);
    hideApproval();
    showResult(data.answer, data.thread_id, false);
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false, "approval");
  }
}

function copyResult() {
  const resultBox = document.getElementById("resultBox");
  const text = resultBox.innerText;

  if (!text) {
    return;
  }

  navigator.clipboard.writeText(text)
    .then(() => {
      const copyBtn = document.querySelector(".copy-btn");
      const oldText = copyBtn.textContent;
      copyBtn.textContent = "Copied!";

      setTimeout(() => {
        copyBtn.textContent = oldText;
      }, 1400);
    })
    .catch(() => {
      showError("Could not copy result.");
    });
}


async function downloadPDF() {
  const pdfContent = document.getElementById("pdfContent");

  if (!latestAnswerMarkdown || !pdfContent) {
    showError("No travel plan available to download.");
    return;
  }

  if (typeof html2pdf === "undefined") {
    showError("PDF library is not loaded. Please refresh the page.");
    return;
  }

  const downloadBtn = document.querySelector(".download-btn");
  const oldText = downloadBtn.textContent;

  downloadBtn.textContent = "Preparing PDF...";
  downloadBtn.disabled = true;

  // Create a separate PDF layout.
  // This does not modify the actual website.
  const exportNode = pdfContent.cloneNode(true);
  exportNode.classList.add("pdf-export");

  const exportStyle = document.createElement("style");

  exportStyle.textContent = `
    .pdf-export {
      width: 273mm !important;
      max-width: 273mm !important;
      box-sizing: border-box !important;
      padding: 12mm !important;
      margin: 0 !important;
      background: #ffffff !important;
      color: #1f2937 !important;
      border-radius: 0 !important;
      font-family: Arial, Helvetica, sans-serif !important;
      font-size: 10pt !important;
      line-height: 1.55 !important;
      overflow: visible !important;
    }

    .pdf-export * {
      box-sizing: border-box !important;
      max-width: 100%;
    }

    .pdf-export .pdf-title {
      display: block !important;
      color: #1e3a8a !important;
      font-size: 25pt !important;
      margin-bottom: 22px !important;
      padding-bottom: 12px !important;
      border-bottom: 3px solid #2563eb !important;
    }

    .pdf-export h1,
    .pdf-export h2,
    .pdf-export h3 {
      color: #172554 !important;
      page-break-after: avoid !important;
      break-after: avoid !important;
    }

    .pdf-export h1 {
      font-size: 21pt !important;
    }

    .pdf-export h2 {
      font-size: 15pt !important;
      margin-top: 22px !important;
      padding: 9px 12px !important;
      background: #eff6ff !important;
      border-left: 4px solid #2563eb !important;
      border-radius: 4px !important;
    }

    .pdf-export h3 {
      font-size: 12pt !important;
      margin-top: 16px !important;
    }

    .pdf-export p,
    .pdf-export li {
      font-size: 9.5pt !important;
      line-height: 1.55 !important;
      color: #374151 !important;
      overflow-wrap: anywhere !important;
    }

    .pdf-export p {
      margin-bottom: 10px !important;
    }

    .pdf-export ul,
    .pdf-export ol {
      padding-left: 22px !important;
      margin: 10px 0 16px !important;
    }

    .pdf-export table {
      width: 100% !important;
      max-width: 100% !important;
      table-layout: fixed !important;
      border-collapse: collapse !important;
      margin: 14px 0 20px !important;
      page-break-inside: auto !important;
      break-inside: auto !important;
      font-size: 8pt !important;
    }

    .pdf-export thead {
      display: table-header-group !important;
    }

    .pdf-export tr {
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }

    .pdf-export th,
    .pdf-export td {
      border: 1px solid #d1d5db !important;
      padding: 6px !important;
      text-align: left !important;
      vertical-align: top !important;
      white-space: normal !important;
      overflow-wrap: anywhere !important;
      word-break: normal !important;
      color: #374151 !important;
    }

    .pdf-export th {
      background: #dbeafe !important;
      color: #172554 !important;
      font-weight: bold !important;
    }

    .pdf-export hr {
      border: 0 !important;
      border-top: 1px solid #d1d5db !important;
      margin: 20px 0 !important;
    }

    .pdf-export pre,
    .pdf-export blockquote {
      white-space: pre-wrap !important;
      overflow-wrap: anywhere !important;
    }

    .pdf-export a {
      color: #1d4ed8 !important;
      overflow-wrap: anywhere !important;
    }
  `;

  exportNode.prepend(exportStyle);

  // Keep the temporary document measurable by html2canvas.
  exportNode.style.position = "absolute";
  exportNode.style.left = "0";
  exportNode.style.top = "0";
  exportNode.style.zIndex = "-9999";

  document.body.appendChild(exportNode);

  const options = {
    margin: [10, 12, 12, 12],
    filename: "TripMate_AI_Travel_Plan.pdf",

    image: {
      type: "jpeg",
      quality: 0.98
    },

    html2canvas: {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      scrollX: 0,
      scrollY: 0,
      windowWidth: 1200
    },

    jsPDF: {
      unit: "mm",
      format: "a4",
      orientation: "landscape",
      compress: true
    },

    pagebreak: {
      mode: ["css", "legacy"],
      avoid: ["tr", "h1", "h2", "h3"]
    }
  };

  try {
    await html2pdf()
      .set(options)
      .from(exportNode)
      .save();

  } catch (error) {
    console.error("PDF generation error:", error);
    showError("Could not generate PDF. Please try again.");

  } finally {
    exportNode.remove();
    downloadBtn.textContent = oldText;
    downloadBtn.disabled = false;
  }
}


document.addEventListener("keydown", function(event) {
  if (event.ctrlKey && event.key === "Enter") {
    sendMessage();
  }
});