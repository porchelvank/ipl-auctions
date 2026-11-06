
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "change_this_password";
const TIMER = Number(process.env.AUCTION_TIMER) || 20;
const BASE_PRICE = Number(process.env.BASE_PRICE) || 0.20;
const INCREMENT = Number(process.env.BID_INCREMENT) || 0.05;
const TEAM_PURSE = Number(process.env.TEAM_PURSE) || 120;
const DATA_FILE = path.join(__dirname, "auction-data.json");

const TEAM_NAMES = ["CSK", "MI", "RCB", "RR"];

// All 100 players
const playerData = `
Shreyas Gopal|All Rounder
Virat Kohli|Batsman
Jaydev Unadkat|Bowler
MS Dhoni|Wicket Keeper
Rinku Singh|Batsman
Andrew Tye|Bowler
Kieron Pollard|All Rounder
Murali Vijay|Batsman
Rashid Khan|Bowler
Manish Pandey|Batsman
Abhishek Sharma|All Rounder
Sandeep Sharma|Bowler
Adam Gilchrist|Wicket Keeper
Saurabh Tiwary|Batsman
Andre Russell|All Rounder
Amit Mishra|Bowler
Tilak Varma|Batsman
Dinesh Karthik|Wicket Keeper
Praveen Kumar|Bowler
David Warner|Batsman
Washington Sundar|All Rounder
Rahul Tripathi|Batsman
Lasith Malinga|Bowler
Heinrich Klaasen|Wicket Keeper
Yusuf Pathan|All Rounder
Shubman Gill|Batsman
Ishant Sharma|Bowler
Sanju Samson|Wicket Keeper
Deepak Hooda|All Rounder
Chris Gayle|Batsman
Varun Chakravarthy|Bowler
Faf du Plessis|Batsman
Hardik Pandya|All Rounder
Umesh Yadav|Bowler
Ishan Kishan|Wicket Keeper
Ajinkya Rahane|Batsman
Imran Tahir|Bowler
Shivam Dube|All Rounder
AB de Villiers|Batsman
Avesh Khan|Bowler
Jos Buttler|Wicket Keeper
Vijay Shankar|All Rounder
Ruturaj Gaikwad|Batsman
Zaheer Khan|Bowler
Moeen Ali|All Rounder
Prithvi Shaw|Batsman
Trent Boult|Bowler
Nicholas Pooran|Wicket Keeper
James Faulkner|All Rounder
Gautam Gambhir|Batsman
Mohammed Siraj|Bowler
Wriddhiman Saha|Wicket Keeper
Ravindra Jadeja|All Rounder
Mayank Agarwal|Batsman
Kuldeep Yadav|Bowler
Steve Smith|Batsman
Chris Morris|All Rounder
Bhuvneshwar Kumar|Bowler
Quinton de Kock|Wicket Keeper
Irfan Pathan|All Rounder
Suryakumar Yadav|Batsman
Dale Steyn|Bowler
Shikhar Dhawan|Batsman
Daniel Vettori|All Rounder
Mohammed Shami|Bowler
Rishabh Pant|Wicket Keeper
Nitish Kumar Reddy|All Rounder
Robin Uthappa|Batsman
Yuzvendra Chahal|Bowler
Kane Williamson|Batsman
Thisara Perera|All Rounder
Harbhajan Singh|Bowler
KL Rahul|Wicket Keeper
Suresh Raina|Batsman
Mitchell Marsh|All Rounder
Anil Kumble|Bowler
Sai Sudharsan|Batsman
Jonny Bairstow|Wicket Keeper
Glenn Maxwell|All Rounder
Kagiso Rabada|Bowler
Ambati Rayudu|Batsman
Ashish Nehra|Bowler
Axar Patel|All Rounder
Yashasvi Jaiswal|Batsman
Mustafizur Rahman|Bowler
Parthiv Patel|Wicket Keeper
Rahul Tewatia|All Rounder
Manvinder Bisla|Wicket Keeper
Mandeep Singh|Batsman
Navdeep Saini|Bowler
Kedar Jadhav|All Rounder
Devdutt Padikkal|Batsman
Ankit Rajpoot|Bowler
Naman Ojha|Wicket Keeper
Shreyas Iyer|Batsman
Pat Cummins|Bowler
Dwayne Bravo|All Rounder
Riyan Parag|All Rounder
Varun Aaron|Bowler
Brendon McCullum|Batsman
`.trim().split("\n").map((line, index) => {
  const [name, role] = line.split("|");
  return {
    id: index + 1,
    name,
    role,
    basePrice: BASE_PRICE
  };
});

// Create fresh auction
function freshState() {
  const teams = {};

  TEAM_NAMES.forEach(id => {
    teams[id] = {
      id,
      purse: TEAM_PURSE,
      squad: []
    };
  });

  return {
    currentIndex: -1,
    currentPlayer: null,
    currentBid: 0,
    highestBidder: null,
    endsAt: null,
    pausedRemaining: 0,
    status: "WAITING",
    finished: false,
    teams,
    soldPlayers: [],
    unsoldPlayers: [],
    history: []
  };
}

function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

      if (
        saved &&
        saved.teams &&
        Array.isArray(saved.soldPlayers) &&
        Array.isArray(saved.unsoldPlayers) &&
        Array.isArray(saved.history)
      ) {
        return saved;
      }
    }
  } catch (error) {
    console.error("Could not load saved auction:", error.message);
  }

  return freshState();
}

let state = loadState();
let timerInterval = null;
let nextPlayerTimeout = null;

const teamOwners = new Map();

function saveState() {
  const tempFile = DATA_FILE + ".tmp";

  fs.writeFileSync(tempFile, JSON.stringify(state, null, 2));
  fs.renameSync(tempFile, DATA_FILE);
}

function publicState() {
  const claimedTeams = {};

  TEAM_NAMES.forEach(team => {
    claimedTeams[team] = teamOwners.has(team);
  });

  return {
    ...state,
    claimedTeams
  };
}

function broadcast() {
  io.emit("auctionUpdate", publicState());
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function startTimer() {
  stopTimer();

  state.endsAt = Date.now() + TIMER * 1000;
  state.status = "LIVE";

  timerInterval = setInterval(() => {
    if (state.status !== "LIVE") {
      stopTimer();
      return;
    }

    if (Date.now() >= state.endsAt) {
      stopTimer();
      settleAuction();
    }
  }, 200);

  saveState();
  broadcast();
}

function startNextPlayer() {
  clearTimeout(nextPlayerTimeout);
  nextPlayerTimeout = null;

  if (state.currentIndex + 1 >= playerData.length) {
    state.currentPlayer = null;
    state.finished = true;
    state.status = "FINISHED";
    state.endsAt = null;
    state.highestBidder = null;
    saveState();
    broadcast();
    return;
  }

  state.currentIndex++;

  state.currentPlayer = playerData[state.currentIndex];
  state.currentBid = state.currentPlayer.basePrice;
  state.highestBidder = null;
  state.endsAt = null;
  state.pausedRemaining = 0;
  state.status = "LIVE";

  startTimer();
}

function settleAuction() {
  if (state.status !== "LIVE" || !state.currentPlayer) return;

  stopTimer();
  state.endsAt = null;

  const player = state.currentPlayer;
  const winner = state.highestBidder;

  if (winner && state.teams[winner]) {
    const team = state.teams[winner];

    if (
      team.squad.length < 25 &&
      team.purse >= state.currentBid
    ) {
      team.purse = Number(
        (team.purse - state.currentBid).toFixed(2)
      );

      team.squad.push({
        ...player,
        soldPrice: state.currentBid
      });

      state.soldPlayers.push({
        ...player,
        team: winner,
        soldPrice: state.currentBid
      });

      state.history.push({
        player: player.name,
        result: "SOLD",
        team: winner,
        price: state.currentBid
      });

      state.status = "SOLD";
    } else {
      state.unsoldPlayers.push(player);

      state.history.push({
        player: player.name,
        result: "UNSOLD",
        team: null,
        price: 0
      });

      state.status = "UNSOLD";
    }
  } else {
    state.unsoldPlayers.push(player);

    state.history.push({
      player: player.name,
      result: "UNSOLD",
      team: null,
      price: 0
    });

    state.status = "UNSOLD";
  }

  state.highestBidder = null;
  state.pausedRemaining = 0;

  saveState();
  broadcast();

  nextPlayerTimeout = setTimeout(() => {
    if (state.status === "SOLD" || state.status === "UNSOLD") {
      startNextPlayer();
    }
  }, 2500);
}

function adminLogin(socket, key) {
  const a = Buffer.from(String(key || ""));
  const b = Buffer.from(ADMIN_KEY);

  const valid =
    a.length === b.length &&
    crypto.timingSafeEqual(a, b);

  socket.data.isAdmin = valid;

  socket.emit("adminAuthResult", {
    ok: valid,
    message: valid ? "Admin login successful." : "Incorrect password."
  });
}

// Main auction page
function mainPage() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>IPL Auction Pro</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#090d18;color:white;font-family:Arial}
header{background:#151d32;text-align:center;padding:22px;border-bottom:2px solid #eab543}
h1{color:#ffc857}
a{color:#ffc857}
.container{max-width:1100px;margin:auto;padding:15px}
.panel{background:#151d32;border:1px solid #293652;border-radius:13px;padding:18px;margin-bottom:18px}
h2{color:#ffc857}
select,button{padding:13px;border-radius:8px;border:0;margin:8px 0}
select{width:100%;background:#263451;color:white}
button{background:#eab543;font-weight:bold;cursor:pointer}
button:disabled{background:#555;color:#aaa;cursor:not-allowed}
.player{text-align:center;background:#202d4b;padding:30px;border-radius:12px;border:1px solid #dba93c}
.player h2{font-size:30px;color:white}
.price{font-size:34px;color:#ffc857;font-weight:bold}
.timer{font-size:38px;color:#52e6a0;margin:12px}
.teams{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.team{background:#202d48;padding:12px;border-radius:10px;overflow-wrap:anywhere}
.team h3{color:#ffc857}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.item{padding:9px;border-bottom:1px solid #34405a;font-size:14px}
.muted{color:#aaa;font-size:13px}
.status{font-weight:bold;color:#52e6a0}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.chip{padding:7px 10px;background:#263451;border-radius:20px;font-size:12px}
.taken{color:#ff9999}.free{color:#83e6b2}
.bar{height:12px;background:#34405a;border-radius:10px;overflow:hidden;margin-top:10px}
.fill{height:100%;background:#eab543;width:0}
@media(max-width:650px){.teams{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}.player h2{font-size:23px}}
</style>
</head>
<body>
<header>
<h1>🏏 IPL AUCTION PRO</h1>
<p>Live Cricket Player Auction</p>
<a href="/admin">Host / Admin Panel</a>
</header>

<main class="container">
<section class="panel">
<h2>SELECT YOUR TEAM</h2>
<select id="team">
<option value="">-- Select Team --</option>
<option value="CSK">Chennai Super Kings (CSK)</option>
<option value="MI">Mumbai Indians (MI)</option>
<option value="RCB">Royal Challengers Bengaluru (RCB)</option>
<option value="RR">Rajasthan Royals (RR)</option>
</select>
<p id="teamMessage" class="muted">Choose an available team.</p>
<div id="availability" class="chips"></div>
</section>

<section class="panel">
<h2>LIVE AUCTION</h2>
<div class="player">
<p id="number" class="muted">Waiting for host...</p>
<h2 id="playerName">Waiting for host...</h2>
<p id="role" class="muted">-</p>
<p class="muted">CURRENT BID</p>
<div id="price" class="price">₹0.20 Cr</div>
<p id="bidder" class="muted">No bids yet</p>
<div id="timer" class="timer">--</div>
<p id="status" class="status">WAITING</p>
<button id="bidButton" disabled>BIDDING UNAVAILABLE</button>
</div>
</section>

<section class="panel">
<h2>TEAM DASHBOARD</h2>
<div id="teams" class="teams"></div>
</section>

<section class="panel">
<h2>AUCTION PROGRESS</h2>
<p id="progress">0 / 100</p>
<div class="bar"><div id="fill" class="fill"></div></div>
</section>

<div class="grid">
<section class="panel"><h2>SOLD PLAYERS</h2><div id="sold">No players sold yet.</div></section>
<section class="panel"><h2>UNSOLD PLAYERS</h2><div id="unsold">No unsold players yet.</div></section>
</div>

<section class="panel">
<h2>AUCTION HISTORY</h2>
<div id="history">No history yet.</div>
</section>
</main>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket=io();
let data=null;
let selected=localStorage.getItem("iplTeam")||"";
const teamSelect=document.getElementById("team");
const bidButton=document.getElementById("bidButton");
teamSelect.value=selected;

function money(n){return "₹"+Number(n||0).toFixed(2)+" Cr"}

teamSelect.addEventListener("change",()=>{
  if(!teamSelect.value){
    selected="";
    localStorage.removeItem("iplTeam");
    return;
  }
  socket.emit("joinTeam",teamSelect.value);
});

socket.on("connect",()=>{
  if(selected)socket.emit("joinTeam",selected);
});

socket.on("teamJoined",d=>{
  selected=d.team;
  localStorage.setItem("iplTeam",selected);
  teamSelect.value=selected;
  document.getElementById("teamMessage").textContent="Connected as "+selected;
  render();
});

socket.on("auctionError",msg=>{
  alert(msg);
});

socket.on("auctionUpdate",d=>{
  data=d;
  render();
});

bidButton.addEventListener("click",()=>{
  if(selected)socket.emit("placeBid");
});

function render(){
  if(!data)return;
  const p=data.currentPlayer;
  document.getElementById("playerName").textContent=
    p?p.name:(data.finished?"AUCTION COMPLETED":"Waiting for host...");
  document.getElementById("role").textContent=p?p.role:"-";
  document.getElementById("number").textContent=
    p?"PLAYER "+(data.currentIndex+1)+" / 100":
    (data.soldPlayers.length+data.unsoldPlayers.length)+" / 100 PLAYERS";
  document.getElementById("price").textContent=money(data.currentBid);
  document.getElementById("bidder").textContent=
    data.highestBidder?"Highest Bidder: "+data.highestBidder:"No bids yet";
  document.getElementById("status").textContent=data.status;

  const team=selected&&data.teams[selected];
  const nextBid=data.highestBidder?
    Number(data.currentBid)+${INCREMENT}:Number(data.currentBid);

  const canBid=data.status==="LIVE"&&team&&
    team.squad.length<25&&data.highestBidder!==selected&&
    Number(team.purse)>=nextBid;

  bidButton.disabled=!canBid;
  bidButton.textContent=canBid?"🔨 BID "+money(nextBid):"BIDDING UNAVAILABLE";

  const availability=document.getElementById("availability");
  availability.innerHTML="";
  ["CSK","MI","RCB","RR"].forEach(id=>{
    const span=document.createElement("span");
    span.className="chip "+(data.claimedTeams[id]?"taken":"free");
    span.textContent=id+": "+(data.claimedTeams[id]?"Selected":"Available");
    availability.appendChild(span);
  });

  const teams=document.getElementById("teams");
  teams.innerHTML="";
  Object.values(data.teams).forEach(t=>{
    const div=document.createElement("div");
    div.className="team";
    const title=document.createElement("h3");
    title.textContent=t.id;
    const purse=document.createElement("p");
    purse.textContent="Purse: "+money(t.purse);
    const count=document.createElement("p");
    count.textContent="Players: "+t.squad.length;
    const squad=document.createElement("p");
    squad.textContent="Squad: "+(t.squad.map(x=>x.name).join(", ")||"Empty");
    div.append(title,purse,count,squad);
    teams.appendChild(div);
  });

  function fillList(id,items,format,empty){
    const el=document.getElementById(id);
    el.innerHTML="";
    if(!items.length){el.textContent=empty;return}
    items.slice().reverse().forEach(x=>{
      const div=document.createElement("div");
      div.className="item";
      div.textContent=format(x);
      el.appendChild(div);
    });
  }

  fillList("sold",data.soldPlayers,
    x=>x.name+" — "+x.team+" — "+money(x.soldPrice),
    "No players sold yet.");

  fillList("unsold",data.unsoldPlayers,
    x=>x.name+" — UNSOLD","No unsold players yet.");

  fillList("history",data.history,
    x=>x.player+" | "+x.result+" | "+(x.team||"-")+" | "+money(x.price),
    "No history yet.");

  const completed=data.soldPlayers.length+data.unsoldPlayers.length;
  document.getElementById("progress").textContent=completed+" / 100 Players Completed";
  document.getElementById("fill").style.width=completed+"%";
  updateTimer();
}

function updateTimer(){
  if(!data)return;
  const el=document.getElementById("timer");
  if(data.status==="PAUSED"){
    el.textContent=Math.ceil((data.pausedRemaining||0)/1000);
  }else if(data.status==="LIVE"&&data.endsAt){
    const left=Math.max(0,Math.ceil((data.endsAt-Date.now())/1000));
    el.textContent=left;
    el.style.color=left<=5?"#ff7373":"#52e6a0";
  }else{
    el.textContent="--";
  }
}
setInterval(updateTimer,250);
</script>
</body>
</html>`;
}

// Admin page
function adminPage() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>IPL Auction Admin</title>
<style>
body{margin:0;background:#090d18;color:white;font-family:Arial}
header{background:#151d32;text-align:center;padding:22px;border-bottom:2px solid #eab543}
h1,h2{color:#ffc857}
main{max-width:750px;margin:30px auto;padding:15px}
.panel{background:#151d32;border:1px solid #293652;border-radius:13px;padding:20px;margin-bottom:18px}
input{width:100%;padding:14px;box-sizing:border-box;border-radius:8px;background:#263451;color:white;border:1px solid #52627e;margin:12px 0}
button{padding:13px 20px;border:0;border-radius:8px;background:#eab543;font-weight:bold;cursor:pointer;margin:5px}
button:disabled{background:#555;color:#aaa;cursor:not-allowed}
p{color:#ccc}
a{color:#ffc857}
</style>
</head>
<body>
<header>
<h1>🔐 IPL AUCTION HOST PANEL</h1>
<p>Host controls</p>
<a href="/">Back to Auction</a>
</header>
<main>
<section class="panel">
<h2>ADMIN LOGIN</h2>
<input id="key" type="password" placeholder="Enter admin password">
<button id="login">LOGIN</button>
<p id="message">Login to control the auction.</p>
</section>
<section class="panel">
<h2>AUCTION CONTROLS</h2>
<p id="status">Current status: Connecting...</p>
<button id="start" disabled>▶ START / RESUME</button>
<button id="pause" disabled>⏸ PAUSE</button>
<button id="reset" disabled>↻ RESET AUCTION</button>
<p>Reset clears all results and starts again from player 1.</p>
</section>
</main>
<script src="/socket.io/socket.io.js"></script>
<script>
const socket=io();
let isAdmin=false;
const key=document.getElementById("key");
const message=document.getElementById("message");
const start=document.getElementById("start");
const pause=document.getElementById("pause");
const reset=document.getElementById("reset");

function controls(enabled){
  start.disabled=!enabled;
  pause.disabled=!enabled;
  reset.disabled=!enabled;
}

document.getElementById("login").onclick=()=>{
  if(!key.value.trim()){
    message.textContent="Enter the admin password.";
    return;
  }
  socket.emit("adminLogin",key.value);
};

socket.on("adminAuthResult",result=>{
  isAdmin=result.ok;
  message.textContent=result.message;
  controls(isAdmin);
  if(isAdmin)key.value="";
});

socket.on("auctionUpdate",state=>{
  document.getElementById("status").textContent=
    "Current status: "+state.status+
    " | Player: "+(state.currentPlayer?.name||"None");
});

socket.on("adminActionResult",msg=>{
  message.textContent=msg;
});

socket.on("auctionError",msg=>{
  message.textContent=msg;
});

start.onclick=()=>{
  if(isAdmin)socket.emit("adminStart");
};

pause.onclick=()=>{
  if(isAdmin)socket.emit("adminPause");
};

reset.onclick=()=>{
  if(isAdmin&&confirm("Reset all auction results?")){
    socket.emit("adminReset");
  }
};
</script>
</body>
</html>`;
}

// Pages
app.get("/", (req, res) => res.send(mainPage()));
app.get("/admin", (req, res) => res.send(adminPage()));
app.get("/api/state", (req, res) => res.json(publicState()));
app.get("/api/players", (req, res) => res.json(playerData));

// Socket connections
io.on("connection", socket => {
  socket.emit("auctionUpdate", publicState());

  socket.on("adminLogin", key => {
    adminLogin(socket, key);
  });

  socket.on("adminStart", () => {
    if (!socket.data.isAdmin) {
      return socket.emit("auctionError", "Admin login required.");
    }

    if (state.status === "PAUSED") {
      state.status = "LIVE";
      state.endsAt = Date.now() + state.pausedRemaining;
      state.pausedRemaining = 0;

      startTimer();
      socket.emit("adminActionResult", "Auction resumed.");
      return;
    }

    if (state.status === "WAITING") {
      startNextPlayer();
      socket.emit("adminActionResult", "Auction started.");
      return;
    }

    if (state.status === "SOLD" || state.status === "UNSOLD") {
      startNextPlayer();
      socket.emit("adminActionResult", "Next player started.");
      return;
    }

    socket.emit("adminActionResult", "Auction is already running or finished.");
  });

  socket.on("adminPause", () => {
    if (!socket.data.isAdmin) {
      return socket.emit("auctionError", "Admin login required.");
    }

    if (state.status !== "LIVE") {
      return socket.emit("adminActionResult", "Auction is not running.");
    }

    state.pausedRemaining = Math.max(0, state.endsAt - Date.now());
    state.endsAt = null;
    state.status = "PAUSED";

    stopTimer();
    saveState();
    broadcast();

    socket.emit("adminActionResult", "Auction paused.");
  });

  socket.on("adminReset", () => {
    if (!socket.data.isAdmin) {
      return socket.emit("auctionError", "Admin login required.");
    }

    stopTimer();
    clearTimeout(nextPlayerTimeout);

    state = freshState();

    saveState();
    broadcast();

    socket.emit("adminActionResult", "Auction reset successfully.");
  });

  socket.on("joinTeam", team => {
    if (!TEAM_NAMES.includes(team)) {
      return socket.emit("auctionError", "Invalid team.");
    }

    if (socket.data.team === team) {
      return socket.emit("teamJoined", { team });
    }

    if (socket.data.team) {
      return socket.emit("auctionError", "You have already selected a team.");
    }

    if (teamOwners.has(team)) {
      return socket.emit("auctionError", "This team is already selected.");
    }

    teamOwners.set(team, socket.id);
    socket.data.team = team;

    socket.emit("teamJoined", { team });
    broadcast();
  });

  socket.on("placeBid", () => {
    const teamId = socket.data.team;

    if (!teamId || teamOwners.get(teamId) !== socket.id) {
      return socket.emit("auctionError", "Select an available team first.");
    }

    if (state.status !== "LIVE" || !state.currentPlayer) {
      return socket.emit("auctionError", "Auction is not live.");
    }

    if (state.highestBidder === teamId) {
      return socket.emit("auctionError", "Your team is already the highest bidder.");
    }

    const team = state.teams[teamId];

    if (!team || team.squad.length >= 25) {
      return socket.emit("auctionError", "Your squad is full.");
    }

    const amount = state.highestBidder
      ? Number((state.currentBid + INCREMENT).toFixed(2))
      : state.currentBid;

    if (team.purse < amount) {
      return socket.emit("auctionError", "Not enough purse balance.");
    }

    state.currentBid = amount;
    state.highestBidder = teamId;

    // Every new bid restarts the auction countdown.
    startTimer();
  });

  socket.on("disconnect", () => {
    if (socket.data.team && teamOwners.get(socket.data.team) === socket.id) {
      teamOwners.delete(socket.data.team);
      broadcast();
    }
  });
});

// Save and start server
saveState();

server.listen(PORT, () => {
  console.log("--------------------------------");
  console.log("🏏 IPL AUCTION PRO STARTED");
  console.log("Auction: http://localhost:" + PORT);
  console.log("Admin:   http://localhost:" + PORT + "/admin");
  console.log("Players: " + playerData.length);
  console.log("--------------------------------");
});
