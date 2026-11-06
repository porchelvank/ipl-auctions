
const socket = io();

let auctionState = null;
let selectedTeam = localStorage.getItem("iplTeam") || "";

const teamSelect = document.getElementById("teamSelect");
const bidButton = document.getElementById("bidButton");

teamSelect.value = selectedTeam;

// Format price
function money(value) {
  return "₹" + Number(value || 0).toFixed(2) + " Cr";
}

// Select team
function chooseTeam() {
  const requestedTeam = teamSelect.value;

  if (!requestedTeam) {
    selectedTeam = "";
    localStorage.removeItem("iplTeam");

    document.getElementById("selectedMessage").textContent =
      "Select an available team to participate.";

    render();
    return;
  }

  socket.emit("joinTeam", requestedTeam);
}

teamSelect.addEventListener("change", chooseTeam);

// Reconnect to previously selected team
socket.on("connect", () => {
  if (selectedTeam) {
    socket.emit("joinTeam", selectedTeam);
  }
});

// Team successfully selected
socket.on("teamJoined", data => {
  selectedTeam = data.team;

  localStorage.setItem("iplTeam", selectedTeam);

  teamSelect.value = selectedTeam;

  document.getElementById("selectedMessage").textContent =
    "Connected as " + selectedTeam;

  render();
});

// Receive auction updates
socket.on("auctionUpdate", data => {
  auctionState = data;
  render();
});

// Handle errors
socket.on("auctionError", message => {
  alert(message);

  if (
    message.includes("already selected") ||
    message.includes("Invalid team")
  ) {
    selectedTeam = "";

    localStorage.removeItem("iplTeam");

    teamSelect.value = "";

    document.getElementById("selectedMessage").textContent =
      "That team is unavailable. Please select another team.";
  }

  render();
});

// Place bid
bidButton.addEventListener("click", () => {
  if (!selectedTeam) {
    alert("Please select an available team first.");
    return;
  }

  socket.emit("placeBid");
});

// Main rendering function
function render() {
  if (!auctionState) return;

  const s = auctionState;
  const player = s.currentPlayer;

  document.getElementById("playerName").textContent =
    player
      ? player.name
      : (s.finished ? "AUCTION COMPLETED" : "Waiting for host...");

  document.getElementById("playerRole").textContent =
    player ? player.role : "-";

  document.getElementById("currentBid").textContent =
    money(s.currentBid);

  document.getElementById("playerNumber").textContent =
    player
      ? `PLAYER ${s.currentIndex + 1} / 100`
      : `${s.soldPlayers.length + s.unsoldPlayers.length} / 100 PLAYERS`;

  document.getElementById("highestBidder").textContent =
    s.highestBidder
      ? "Highest Bidder: " + s.highestBidder
      : "No bids yet";

  // Auction status
  const status = document.getElementById("auctionStatus");

  status.textContent = s.status;

  status.className =
    "status " +
    (
      s.status === "SOLD"
        ? "green"
        : (s.status === "UNSOLD" || s.status === "PAUSED")
          ? "red"
          : "green"
    );

  // Check bidding eligibility
  const team = selectedTeam && s.teams[selectedTeam];

  const nextBid = s.highestBidder
    ? Number(s.currentBid) + 0.05
    : Number(s.currentBid);

  const canBid =
    s.status === "LIVE" &&
    !!team &&
    team.squad.length < 25 &&
    s.highestBidder !== selectedTeam &&
    Number(team.purse) >= nextBid;

  bidButton.disabled = !canBid;

  bidButton.textContent = canBid
    ? "🔨 BID " + money(nextBid)
    : "BIDDING UNAVAILABLE";

  // Render all sections
  renderTeamAvailability();
  renderTeams();
  renderPlayers();
  renderHistory();

  // Auction progress
  const completed =
    s.soldPlayers.length + s.unsoldPlayers.length;

  document.getElementById("progress").textContent =
    `${completed} / 100 Players Completed`;

  document.getElementById("progressBar").style.width =
    `${Math.min(100, completed)}%`;

  updateTimer();
}

// Show available teams
function renderTeamAvailability() {
  const holder = document.getElementById("teamAvailability");

  holder.innerHTML = "";

  if (!auctionState) return;

  for (const id of ["CSK", "MI", "RCB", "RR"]) {
    const taken = !!auctionState.claimedTeams?.[id];

    const chip = document.createElement("span");

    chip.className =
      "team-chip " + (taken ? "taken" : "free");

    chip.textContent =
      `${id}: ${taken ? "Selected" : "Available"}`;

    holder.appendChild(chip);
  }
}

// Team dashboard
function renderTeams() {
  const container =
    document.getElementById("teamsContainer");

  container.innerHTML = "";

  Object.values(auctionState.teams).forEach(team => {
    const div = document.createElement("div");

    div.className = "team";

    const title = document.createElement("h3");
    title.textContent = team.id;

    const purse = document.createElement("p");
    purse.textContent = "Purse: " + money(team.purse);

    const count = document.createElement("p");
    count.textContent = "Players: " + team.squad.length;

    const players = document.createElement("p");

    players.textContent =
      "Squad: " +
      (team.squad.map(p => p.name).join(", ") || "Empty");

    div.append(title, purse, count, players);

    container.appendChild(div);
  });
}

// Sold and unsold lists
function renderPlayers() {
  const sold = document.getElementById("soldList");
  const unsold = document.getElementById("unsoldList");

  sold.innerHTML = "";
  unsold.innerHTML = "";

  auctionState.soldPlayers.slice().reverse().forEach(p => {
    const item = document.createElement("div");

    item.className = "list-item";

    item.textContent =
      `${p.name} — ${p.team} — ${money(p.soldPrice)}`;

    sold.appendChild(item);
  });

  auctionState.unsoldPlayers.slice().reverse().forEach(p => {
    const item = document.createElement("div");

    item.className = "list-item";

    item.textContent = `${p.name} — UNSOLD`;

    unsold.appendChild(item);
  });

  if (!auctionState.soldPlayers.length) {
    sold.textContent = "No players sold yet.";
  }

  if (!auctionState.unsoldPlayers.length) {
    unsold.textContent = "No unsold players yet.";
  }
}

// Auction history
function renderHistory() {
  const container =
    document.getElementById("historyList");

  container.innerHTML = "";

  auctionState.history.slice().reverse().forEach(item => {
    const div = document.createElement("div");

    div.className = "list-item";

    div.textContent =
      `${item.player} | ${item.result} | ${item.team || "-"} | ${money(item.price)}`;

    container.appendChild(div);
  });

  if (!auctionState.history.length) {
    container.textContent = "No history yet.";
  }
}

// Auction timer
function updateTimer() {
  const timer = document.getElementById("timer");

  if (!auctionState) return;

  if (auctionState.status === "PAUSED") {
    timer.textContent =
      Math.ceil((auctionState.pausedRemaining || 0) / 1000);

    return;
  }

  if (
    !auctionState.endsAt ||
    auctionState.status !== "LIVE"
  ) {
    timer.textContent = "--";
    return;
  }

  const remaining = Math.max(
    0,
    Math.ceil((auctionState.endsAt - Date.now()) / 1000)
  );

  timer.textContent = remaining;

  timer.style.color =
    remaining <= 5 ? "#ff7373" : "#52e6a0";
}

// Refresh timer display
setInterval(updateTimer, 250);
