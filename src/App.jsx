import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import "./App.css";

const avatars = ["🦊", "🐸", "🐼", "🐵", "🐯", "🐺", "🦁", "🐧"];

const rankValues = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8,
  "9": 9, "10": 10, J: 11, Q: 12, K: 13, A: 14,
};

const TURN_SECONDS = 120;

// 1 unit = £0.005
// Green £0.025, Blue £0.05, Black £0.10, Purple £0.50, Gold £1.00
const chipValues = {
  gold: 200,
  purple: 100,
  black: 20,
  blue: 10,
  green: 5,
};

const chipOrder = ["gold", "purple", "black", "blue", "green"];

function App() {
  const [screen, setScreen] = useState("home");
  const [roomCode, setRoomCode] = useState("");
  const [username, setUsername] = useState("");
  const [buyInValue, setBuyInValue] = useState("6.40");
  const [smallBlind, setSmallBlind] = useState("0.05");
  const [bigBlind, setBigBlind] = useState("0.10");
const [chatMessages, setChatMessages] = useState([]);
const [chatInput, setChatInput] = useState("");
const [whisperTo, setWhisperTo] = useState([]);
  const [room, setRoom] = useState(null);
  const [currentPlayer, setCurrentPlayer] = useState(null);
  const [players, setPlayers] = useState([]);
  const [game, setGame] = useState(null);
  const [myHand, setMyHand] = useState([]);
  const [hands, setHands] = useState([]);
  const [logs, setLogs] = useState([]);
  const [chipRequests, setChipRequests] = useState([]);
  const [requestAmount, setRequestAmount] = useState("6.40");
  const [betAmount, setBetAmount] = useState(0);
  const [turnTimer, setTurnTimer] = useState(TURN_SECONDS);
  const [showdownCountdown, setShowdownCountdown] = useState(null);
  const [showShowdownReveal, setShowShowdownReveal] = useState(false);
  const [error, setError] = useState("");

  const lastTurnRef = useRef(null);

  const myGameHand = hands.find((h) => h.player_id === currentPlayer?.id);

  const amountToCall = Math.max(
    0,
    (game?.current_bet || 0) - (myGameHand?.current_bet || 0)
  );

  const maxBet = currentPlayer?.chips || 0;

  const minimumRaise =
    amountToCall > 0 ? amountToCall * 2 : Number(room?.big_blind || poundsToUnits(bigBlind));

  const isMyTurn =
    room?.status === "playing" &&
    game?.phase !== "showdown" &&
    game?.current_turn_seat === currentPlayer?.seat_number;

  const currentTurnPlayer = players.find(
    (player) => player.seat_number === game?.current_turn_seat
  );

  function poundsToUnits(value) {
    return Math.round(Number(value || 0) * 200);
  }

  function formatChips(units) {
    return `£${(Number(units || 0) / 200).toFixed(2)}`;
  }

  function makeBalancedChipStack(totalUnits) {
    let remaining = Number(totalUnits || 0);

    const stack = {
      gold: 0,
      purple: 0,
      black: 0,
      blue: 0,
      green: 0,
    };

    const lowerSetValue =
      5 * chipValues.purple +
      5 * chipValues.black +
      5 * chipValues.blue +
      5 * chipValues.green;

    if (remaining >= lowerSetValue + chipValues.gold) {
      stack.purple = 5;
      stack.black = 5;
      stack.blue = 5;
      stack.green = 5;
      remaining -= lowerSetValue;
    }

    for (const chip of chipOrder) {
      const count = Math.floor(remaining / chipValues[chip]);
      stack[chip] += count;
      remaining -= count * chipValues[chip];
    }

    return stack;
  }

  function getStackVisualProfile(amount) {
    const biggestStack = Math.max(
      ...players.map((p) => Number(p.chips || 0)),
      Number(room?.starting_chips || 0),
      1
    );

    const numericAmount = Number(amount || 0);
    const ratio = numericAmount / biggestStack;

    if (numericAmount <= chipValues.green * 3) {
      return { scale: 0.6, maxPerColor: 1, layerStep: 2 };
    }

    if (ratio < 0.22) {
      return { scale: 0.72, maxPerColor: 2, layerStep: 2 };
    }

    if (ratio < 0.55) {
      return { scale: 0.86, maxPerColor: 3, layerStep: 2.4 };
    }

    return { scale: 1, maxPerColor: 4, layerStep: 2.8 };
  }

  function ChipStack({ amount, orientation = "horizontal" }) {
    const stack = makeBalancedChipStack(amount);
    const { scale, maxPerColor, layerStep } = getStackVisualProfile(amount);

    const visibleColumns = chipOrder
      .map((chip) => ({
        chip,
        count: Math.min(stack[chip], maxPerColor),
      }))
      .filter((entry) => entry.count > 0);

    return (
      <div
        className={`miniStackWrap ${orientation === "vertical" ? "verticalStack" : "horizontalStack"}`}
        style={{ "--stack-scale": scale, "--layer-step": `${layerStep}px` }}
      >
        {visibleColumns.map(({ chip, count }) => (
          <div key={chip} className="chipColumn">
            {Array.from({ length: count }).map((_, index) => (
              <span
                key={`${chip}-${index}`}
                className={`miniPokerChip ${chip}Chip`}
                style={{ bottom: `${index * layerStep}px` }}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  function isRedCard(card) {
    return card?.suit === "♥" || card?.suit === "♦";
  }

  function CardView({ card, small = false }) {
    return (
      <div className={`${small ? "miniCard" : "cardBack"} ${isRedCard(card) ? "redCard" : ""}`}>
        {card ? `${card.rank}${card.suit}` : "?"}
      </div>
    );
  }

  function saveSession(roomData, playerData) {
    localStorage.setItem(
      "pokerSession",
      JSON.stringify({ roomId: roomData.id, playerId: playerData.id })
    );
  }

  function clearSession() {
    localStorage.removeItem("pokerSession");
  }

  async function loadLogs(roomId) {
    const { data, error } = await supabase
      .from("action_logs")
      .select("*")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(12);

    if (!error) setLogs(data || []);
  }

  async function addLog(message, playerName = currentPlayer?.username || null) {
    if (!room?.id) return;

    await supabase.from("action_logs").insert({
      room_id: room.id,
      game_id: game?.id || null,
      player_name: playerName,
      message,
    });

    await loadLogs(room.id);
  }

  async function loadChipRequests(roomId) {
    const { data, error } = await supabase
      .from("chip_requests")
      .select("*")
      .eq("room_id", roomId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (!error) setChipRequests(data || []);
  }
async function loadChatMessages(roomId) {
  if (!currentPlayer?.id) return;

  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .limit(80);

  if (error) {
    setError(error.message);
    return;
  }

  const visibleMessages = (data || []).filter((msg) => {
    if (!msg.visible_to) return true;
    return msg.visible_to.includes(currentPlayer.id);
  });

  setChatMessages(visibleMessages);
}

function toggleWhisperPlayer(playerId) {
  setWhisperTo((current) =>
    current.includes(playerId)
      ? current.filter((id) => id !== playerId)
      : [...current, playerId]
  );
}

async function sendChatMessage() {
  setError("");

  if (!chatInput.trim()) return;
  if (!room?.id || !currentPlayer?.id) return;

  const visibleTo =
    whisperTo.length > 0
      ? [...new Set([...whisperTo, currentPlayer.id])]
      : null;

  const { error } = await supabase.from("chat_messages").insert({
    room_id: room.id,
    sender_id: currentPlayer.id,
    sender_name: currentPlayer.username,
    message: chatInput.trim(),
    visible_to: visibleTo,
  });

  if (error) {
    setError(error.message);
    return;
  }

  setChatInput("");
  setWhisperTo([]);
  await loadChatMessages(room.id);
}
  async function requestMoreChips() {
    setError("");

    if (!room?.id || !currentPlayer?.id) return;

    const requestUnits = poundsToUnits(requestAmount);

    if (requestUnits <= 0) {
      setError("Request amount must be more than £0.00.");
      return;
    }

    const existingPending = chipRequests.find(
      (request) => request.player_id === currentPlayer.id
    );

    if (existingPending) {
      setError("You already have a pending chip request.");
      return;
    }

    const { error } = await supabase.from("chip_requests").insert({
      room_id: room.id,
      player_id: currentPlayer.id,
      player_name: currentPlayer.username,
      amount: requestUnits,
    });

    if (error) {
      setError(error.message);
      return;
    }

    await addLog(`${currentPlayer.username} requested ${formatChips(requestUnits)}`);
    await loadChipRequests(room.id);
  }

  async function topUpSelf() {
    setError("");

    if (!room?.id || !currentPlayer?.id || !currentPlayer?.is_host) return;

    const topUpUnits = poundsToUnits(requestAmount);

    if (topUpUnits <= 0) {
      setError("Top-up amount must be more than £0.00.");
      return;
    }

    const { error: updateError } = await supabase
      .from("players")
      .update({
        chips: Number(currentPlayer.chips || 0) + topUpUnits,
      })
      .eq("id", currentPlayer.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await addLog(`Host topped up ${currentPlayer.username} for ${formatChips(topUpUnits)}`);
    await loadPlayers(room.id);
  }

  async function approveChipRequest(request) {
    if (!currentPlayer?.is_host) return;

    const player = players.find((p) => p.id === request.player_id);

    if (!player) {
      setError("Player not found.");
      return;
    }

    const { error: playerError } = await supabase
      .from("players")
      .update({ chips: Number(player.chips || 0) + Number(request.amount) })
      .eq("id", request.player_id);

    if (playerError) {
      setError(playerError.message);
      return;
    }

    const { error: requestError } = await supabase
      .from("chip_requests")
      .update({ status: "approved" })
      .eq("id", request.id);

    if (requestError) {
      setError(requestError.message);
      return;
    }

    await addLog(`Host approved ${formatChips(request.amount)} for ${request.player_name}`);
    await loadPlayers(room.id);
    await loadChipRequests(room.id);
  }

  async function rejectChipRequest(request) {
    if (!currentPlayer?.is_host) return;

    const { error } = await supabase
      .from("chip_requests")
      .update({ status: "rejected" })
      .eq("id", request.id);

    if (error) {
      setError(error.message);
      return;
    }

    await addLog(`Host rejected ${request.player_name}'s chip request`);
    await loadChipRequests(room.id);
  }

  function playTurnAlert() {
    try {
      if ("vibrate" in navigator) navigator.vibrate(150);

      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.frequency.value = 700;
      gain.gain.value = 0.08;
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.12);
    } catch {
      // ignore
    }
  }

  function generateRoomCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
  }

  function createDeck() {
    const suits = ["♠", "♥", "♦", "♣"];
    const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    const deck = [];

    for (const suit of suits) {
      for (const rank of ranks) deck.push({ rank, suit });
    }

    return deck;
  }

  function shuffleDeck(deck) {
    const shuffled = [...deck];

    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled;
  }

  function getNextSeatFrom(seat, playerList = players) {
    const sortedSeats = playerList.map((p) => p.seat_number).sort((a, b) => a - b);
    const previousSeats = sortedSeats.filter((s) => s < seat);

    return previousSeats.length
      ? previousSeats[previousSeats.length - 1]
      : sortedSeats[sortedSeats.length - 1];
  }

  function getPreviousSeatFrom(seat, playerList = players) {
    const sortedSeats = playerList.map((p) => p.seat_number).sort((a, b) => a - b);
    const nextSeats = sortedSeats.filter((s) => s > seat);

    return nextSeats.length ? nextSeats[0] : sortedSeats[0];
  }

  function getDisplayPlayers() {
    if (!currentPlayer || players.length === 0) return players;

    const ordered = [];
    let seat = currentPlayer.seat_number;

    for (let i = 0; i < players.length; i++) {
      const player = players.find((p) => p.seat_number === seat);
      if (player) ordered.push(player);
      seat = getNextSeatFrom(seat, players);
    }

    return ordered;
  }

  function getTableSeatClass(index, totalPlayers) {
    const maps = {
      2: ["seat1", "seat2"],
      3: ["seat1", "seat3", "seat2"],
      4: ["seat1", "seat3", "seat2", "seat4"],
      5: ["seat1", "seat5", "seat3", "seat2", "seat6"],
      6: ["seat1", "seat5", "seat3", "seat2", "seat6", "seat4"],
      7: ["seat1", "seat7", "seat5", "seat3", "seat2", "seat6", "seat4"],
      8: ["seat1", "seat7", "seat5", "seat3", "seat2", "seat6", "seat4", "seat8"],
    };

    return maps[totalPlayers]?.[index] || `seat${index + 1}`;
  }

  function isSideSeat(seatClass) {
    return ["seat2", "seat4", "seat5", "seat6", "seat7", "seat8"].includes(seatClass);
  }

  function getNextActiveSeat(currentSeat, handsList = hands) {
    let seat = getNextSeatFrom(currentSeat, players);

    for (let i = 0; i < players.length; i++) {
      const player = players.find((p) => p.seat_number === seat);
      const hand = handsList.find((h) => h.player_id === player?.id);

      if (player && hand && !hand.folded && !hand.all_in) return seat;
      seat = getNextSeatFrom(seat, players);
    }

    return currentSeat;
  }

  function getPreviousActiveSeat(currentSeat, handsList = hands) {
    let seat = getPreviousSeatFrom(currentSeat, players);

    for (let i = 0; i < players.length; i++) {
      const player = players.find((p) => p.seat_number === seat);
      const hand = handsList.find((h) => h.player_id === player?.id);

      if (player && hand && !hand.folded && !hand.all_in) return seat;
      seat = getPreviousSeatFrom(seat, players);
    }

    return currentSeat;
  }

  function getFirstActiveFromSeat(startSeat, handsList = hands) {
    let seat = startSeat;

    for (let i = 0; i < players.length; i++) {
      const player = players.find((p) => p.seat_number === seat);
      const hand = handsList.find((h) => h.player_id === player?.id);

      if (player && hand && !hand.folded && !hand.all_in) return seat;
      seat = getNextSeatFrom(seat, players);
    }

    return startSeat;
  }

  function countActivePlayers(handsList = hands) {
    return handsList.filter((hand) => !hand.folded).length;
  }

  function shouldGoStraightToShowdown(handsList = hands, currentBet = game?.current_bet || 0) {
    const activeHands = handsList.filter((hand) => !hand.folded);
    const actionableHands = handsList.filter((hand) => !hand.folded && !hand.all_in);

    if (activeHands.length <= 1) return true;
    if (actionableHands.length === 0) return true;

    if (actionableHands.length === 1) {
      const remainingHand = actionableHands[0];
      return (remainingHand.current_bet || 0) >= currentBet;
    }

    return false;
  }

function getBlindSeats(playerList = players, dealerSeatOverride = null) {
  const dealerSeat = dealerSeatOverride || room?.current_dealer_seat || 1;

  // This function gives the next seat clockwise in your current app layout.
  const nextClockwiseSeat = getNextSeatFrom(dealerSeat, playerList);

  // HEADS-UP:
  // Dealer = Big Blind
  // Other player = Small Blind
  if (playerList.length === 2) {
    return {
      dealerSeat,
      smallBlindSeat: nextClockwiseSeat,
      bigBlindSeat: dealerSeat,
      firstPreflopSeat: nextClockwiseSeat,
      firstPostflopSeat: nextClockwiseSeat,
    };
  }

  // 3+ PLAYERS:
  // Dealer -> Small Blind -> Big Blind clockwise
  const smallBlindSeat = nextClockwiseSeat;
  const bigBlindSeat = getNextSeatFrom(smallBlindSeat, playerList);
  const firstPreflopSeat = getNextSeatFrom(bigBlindSeat, playerList);

  return {
    dealerSeat,
    smallBlindSeat,
    bigBlindSeat,
    firstPreflopSeat,
    firstPostflopSeat: smallBlindSeat,
  };
}

  function getRoleLabel(player) {
  const blindSeats = players.length >= 2 ? getBlindSeats(players) : null;
  if (!blindSeats) return "";

  const labels = [];

  if (player.seat_number === blindSeats.dealerSeat) labels.push("D");
  if (player.seat_number === blindSeats.smallBlindSeat) labels.push("SB");
  if (player.seat_number === blindSeats.bigBlindSeat) labels.push("BB");

  return labels.join("/");
}

  function combinations(array, size) {
    const result = [];

    function backtrack(start, combo) {
      if (combo.length === size) {
        result.push(combo);
        return;
      }

      for (let i = start; i < array.length; i++) {
        backtrack(i + 1, [...combo, array[i]]);
      }
    }

    backtrack(0, []);
    return result;
  }

  function evaluateFiveCards(cards) {
    const values = cards.map((card) => rankValues[card.rank]).sort((a, b) => b - a);
    const suits = cards.map((card) => card.suit);
    const isFlush = suits.every((suit) => suit === suits[0]);
    const uniqueValues = [...new Set(values)].sort((a, b) => b - a);

    let straightHigh = null;

    if (uniqueValues.length === 5) {
      if (uniqueValues[0] - uniqueValues[4] === 4) straightHigh = uniqueValues[0];
      else if (JSON.stringify(uniqueValues) === JSON.stringify([14, 5, 4, 3, 2])) {
        straightHigh = 5;
      }
    }

    const counts = {};
    for (const value of values) counts[value] = (counts[value] || 0) + 1;

    const groups = Object.entries(counts)
      .map(([value, count]) => ({ value: Number(value), count }))
      .sort((a, b) => b.count - a.count || b.value - a.value);

    if (isFlush && straightHigh) return { rank: 8, name: "Straight Flush", tiebreakers: [straightHigh] };

    if (groups[0].count === 4) {
      const four = groups[0].value;
      const kicker = groups.find((g) => g.value !== four).value;
      return { rank: 7, name: "Four of a Kind", tiebreakers: [four, kicker] };
    }

    if (groups[0].count === 3 && groups[1].count === 2) {
      return { rank: 6, name: "Full House", tiebreakers: [groups[0].value, groups[1].value] };
    }

    if (isFlush) return { rank: 5, name: "Flush", tiebreakers: values };
    if (straightHigh) return { rank: 4, name: "Straight", tiebreakers: [straightHigh] };

    if (groups[0].count === 3) {
      const trips = groups[0].value;
      const kickers = groups.filter((g) => g.value !== trips).map((g) => g.value);
      return { rank: 3, name: "Three of a Kind", tiebreakers: [trips, ...kickers] };
    }

    if (groups[0].count === 2 && groups[1].count === 2) {
      const pairs = groups.filter((g) => g.count === 2).map((g) => g.value);
      const kicker = groups.find((g) => g.count === 1).value;
      return { rank: 2, name: "Two Pair", tiebreakers: [...pairs, kicker] };
    }

    if (groups[0].count === 2) {
      const pair = groups[0].value;
      const kickers = groups.filter((g) => g.value !== pair).map((g) => g.value);
      return { rank: 1, name: "One Pair", tiebreakers: [pair, ...kickers] };
    }

    return { rank: 0, name: "High Card", tiebreakers: values };
  }

  function compareScores(a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;

    for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i++) {
      const difference = (a.tiebreakers[i] || 0) - (b.tiebreakers[i] || 0);
      if (difference !== 0) return difference;
    }

    return 0;
  }

  function getBestHand(cards) {
    const allFiveCardHands = combinations(cards, 5);
    let best = null;

    for (const fiveCards of allFiveCardHands) {
      const score = evaluateFiveCards(fiveCards);
      if (!best || compareScores(score, best.score) > 0) {
        best = { cards: fiveCards, score };
      }
    }

    return best;
  }

  async function loadPlayers(roomId) {
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .order("seat_number", { ascending: true });

    if (error) {
      setError(error.message);
      return;
    }

    setPlayers(data || []);

    if (currentPlayer?.id) {
      const refreshedCurrentPlayer = data?.find((p) => p.id === currentPlayer.id);
      if (refreshedCurrentPlayer) setCurrentPlayer(refreshedCurrentPlayer);
    }
  }

  async function loadRoom(roomId) {
    const { data, error } = await supabase.from("rooms").select("*").eq("id", roomId).single();

    if (error) {
      setError(error.message);
      return;
    }

    setRoom(data);
  }

  async function loadGame(roomId) {
    const { data, error } = await supabase
      .from("games")
      .select("*")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      setError(error.message);
      return;
    }

    setGame(data);
  }

  async function loadMyHand(gameId, playerId) {
    const { data, error } = await supabase
      .from("player_hands")
      .select("*")
      .eq("game_id", gameId)
      .eq("player_id", playerId)
      .maybeSingle();

    if (error) {
      setError(error.message);
      return;
    }

    setMyHand(data?.cards || []);
  }

  async function loadHands(gameId) {
    const { data, error } = await supabase
      .from("player_hands")
      .select("*")
      .eq("game_id", gameId);

    if (error) {
      setError(error.message);
      return;
    }

    setHands(data || []);
  }

  async function createRoom() {
    setError("");

    if (!username.trim()) {
      setError("Enter a username first.");
      return;
    }

    const smallBlindUnits = poundsToUnits(smallBlind);
    const bigBlindUnits = poundsToUnits(bigBlind);
    const buyInUnits = poundsToUnits(buyInValue);

    if (buyInUnits <= 0) {
      setError("Buy-in must be more than £0.00.");
      return;
    }

    if (bigBlindUnits <= smallBlindUnits) {
      setError("Big blind must be larger than small blind.");
      return;
    }

    const code = generateRoomCode();

    const { data: roomData, error: roomError } = await supabase
      .from("rooms")
      .insert({
        room_code: code,
        host_name: username,
        starting_chips: buyInUnits,
        small_blind: smallBlindUnits,
        big_blind: bigBlindUnits,
        current_dealer_seat: 1,
      })
      .select()
      .single();

    if (roomError) {
      setError(roomError.message);
      return;
    }

    const { data: playerData, error: playerError } = await supabase
      .from("players")
      .insert({
        room_id: roomData.id,
        username,
        avatar: avatars[0],
        chips: buyInUnits,
        seat_number: 1,
        is_host: true,
      })
      .select()
      .single();

    if (playerError) {
      setError(playerError.message);
      return;
    }

    saveSession(roomData, playerData);
    setRoom(roomData);
    setCurrentPlayer(playerData);
    setRoomCode(code);
    await loadPlayers(roomData.id);
    setScreen("table");
  }

  async function joinRoom() {
    setError("");

    if (!username.trim()) {
      setError("Enter a username first.");
      return;
    }

    if (!roomCode.trim()) {
      setError("Enter a room code.");
      return;
    }

    const { data: roomData, error: roomError } = await supabase
      .from("rooms")
      .select("*")
      .eq("room_code", roomCode.toUpperCase())
      .single();

    if (roomError || !roomData) {
      setError("Room not found.");
      return;
    }

    if (roomData.status !== "waiting") {
      setError("This game has already started.");
      return;
    }

    const { data: existingPlayers, error: playersError } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", roomData.id)
      .order("seat_number", { ascending: true });

    if (playersError) {
      setError(playersError.message);
      return;
    }

    if (existingPlayers.length >= 8) {
      setError("This room is full.");
      return;
    }

    const seatNumber = existingPlayers.length + 1;
    const avatar = avatars[(seatNumber - 1) % avatars.length];

    const { data: playerData, error: playerError } = await supabase
      .from("players")
      .insert({
        room_id: roomData.id,
        username,
        avatar,
        chips: roomData.starting_chips,
        seat_number: seatNumber,
        is_host: false,
      })
      .select()
      .single();

    if (playerError) {
      setError(playerError.message);
      return;
    }

    saveSession(roomData, playerData);
    setRoom(roomData);
    setCurrentPlayer(playerData);
    await loadPlayers(roomData.id);
    setScreen("table");
  }

  async function createNewHand(dealerSeat) {
    setError("");

    const eligiblePlayers = players.filter((player) => player.chips > 0);

    if (eligiblePlayers.length < 2) {
      setError("Not enough players with chips to start another round.");
      return;
    }

    const { dealerSeat: dealer, smallBlindSeat, bigBlindSeat, firstPreflopSeat } =
      getBlindSeats(eligiblePlayers, dealerSeat);

    const shuffledDeck = shuffleDeck(createDeck());
    const handsToInsert = [];

    let deckIndex = 0;
    let startingPot = 0;

    for (const player of eligiblePlayers) {
      let startingBet = 0;

      if (player.seat_number === smallBlindSeat) startingBet = Number(room.small_blind);
      if (player.seat_number === bigBlindSeat) startingBet = Number(room.big_blind);
      if (startingBet > player.chips) startingBet = player.chips;

      startingPot += startingBet;

      handsToInsert.push({
        player_id: player.id,
        cards: [shuffledDeck[deckIndex], shuffledDeck[deckIndex + 1]],
        current_bet: startingBet,
        total_committed: startingBet,
        folded: false,
        all_in: player.chips - startingBet === 0,
      });

      deckIndex += 2;
    }

    const remainingDeck = shuffledDeck.slice(deckIndex);

    const { data: gameData, error: gameError } = await supabase
      .from("games")
      .insert({
        room_id: room.id,
        deck: remainingDeck,
        community_cards: [],
        pot: startingPot,
        current_turn_seat: firstPreflopSeat,
        current_bet: Number(room.big_blind),
        round_closer_seat: bigBlindSeat,
        last_raiser_seat: bigBlindSeat,
        phase: "preflop",
        game_result: null,
        pot_awarded: false,
      })
      .select()
      .single();

    if (gameError) {
      setError(gameError.message);
      return;
    }

    const handsWithGameId = handsToInsert.map((hand) => ({
      ...hand,
      game_id: gameData.id,
    }));

    const { error: handsError } = await supabase.from("player_hands").insert(handsWithGameId);

    if (handsError) {
      setError(handsError.message);
      return;
    }

    for (const player of eligiblePlayers) {
      const hand = handsToInsert.find((h) => h.player_id === player.id);
      const blindPayment = hand?.current_bet || 0;

      if (blindPayment > 0) {
        await supabase
          .from("players")
          .update({ chips: player.chips - blindPayment })
          .eq("id", player.id);
      }
    }

    await supabase
      .from("rooms")
      .update({ status: "playing", current_dealer_seat: dealer })
      .eq("id", room.id);

    await addLog("New hand dealt");
    await loadPlayers(room.id);
    loadChatMessages(room.id);
    await loadRoom(room.id);
    await loadGame(room.id);
  }

  async function startGame() {
    await createNewHand(room?.current_dealer_seat || 1);
  }

  async function nextRound() {
    if (!currentPlayer?.is_host) return;

    setShowdownCountdown(null);
    setShowShowdownReveal(false);

    const nextDealerSeat = getNextSeatFrom(room.current_dealer_seat, players);

    await supabase
      .from("rooms")
      .update({ current_dealer_seat: nextDealerSeat })
      .eq("id", room.id);

    await loadRoom(room.id);
    await createNewHand(nextDealerSeat);
  }

  async function resetRoom() {
    if (!currentPlayer?.is_host || !room?.id) return;

    await supabase.from("games").delete().eq("room_id", room.id);
    await supabase.from("action_logs").delete().eq("room_id", room.id);
    await supabase.from("chip_requests").update({ status: "rejected" }).eq("room_id", room.id);

    const { data: roomPlayers } = await supabase
      .from("players")
      .select("*")
      .eq("room_id", room.id);

    for (const player of roomPlayers || []) {
      await supabase
        .from("players")
        .update({ chips: room.starting_chips })
        .eq("id", player.id);
    }

    await supabase
      .from("rooms")
      .update({ status: "waiting", current_dealer_seat: 1 })
      .eq("id", room.id);

    await loadPlayers(room.id);
    await loadRoom(room.id);
    await loadGame(room.id);
    await loadLogs(room.id);
    await loadChipRequests(room.id);
  }

  async function showdownAndAward(communityCardsOverride = null, potOverride = null, handsOverride = null) {
    if (!game || game.pot_awarded) return;

    const finalCommunityCards = communityCardsOverride || game.community_cards || [];
    const handsForAward = handsOverride || hands;
    const committedHands = handsForAward.filter((hand) => (hand.total_committed || 0) > 0);

    if (committedHands.length === 0) {
      setError("No committed chips found.");
      return;
    }

    const commitmentLevels = [
      ...new Set(committedHands.map((hand) => hand.total_committed || 0)),
    ].sort((a, b) => a - b);

    const payouts = {};
    const potResults = [];
    let previousLevel = 0;

    for (const level of commitmentLevels) {
      const contributors = committedHands.filter((hand) => (hand.total_committed || 0) >= level);
      const potAmount = (level - previousLevel) * contributors.length;
      previousLevel = level;

      if (potAmount <= 0) continue;

      const eligibleHands = contributors.filter((hand) => !hand.folded);
      if (eligibleHands.length === 0) continue;

      let winners = [];

      if (eligibleHands.length === 1) {
        const winnerPlayer = players.find((p) => p.id === eligibleHands[0].player_id);
        winners = [{
          player_id: winnerPlayer.id,
          username: winnerPlayer.username,
          hand_name: "Won by fold",
          score: null,
        }];
      } else {
        const evaluated = eligibleHands.map((hand) => {
          const player = players.find((p) => p.id === hand.player_id);
          const bestHand = getBestHand([...(hand.cards || []), ...finalCommunityCards]);

          return {
            player_id: player.id,
            username: player.username,
            hand_name: bestHand.score.name,
            score: bestHand.score,
          };
        });

        evaluated.sort((a, b) => compareScores(b.score, a.score));
        const bestScore = evaluated[0].score;
        winners = evaluated.filter((entry) => compareScores(entry.score, bestScore) === 0);
      }

      const share = Math.floor(potAmount / winners.length);
      const remainder = potAmount % winners.length;

      winners.forEach((winner, index) => {
        payouts[winner.player_id] =
          (payouts[winner.player_id] || 0) + share + (index === 0 ? remainder : 0);
      });

      potResults.push({ potAmount, winners, share, remainder });
    }

    for (const [playerId, payout] of Object.entries(payouts)) {
      const player = players.find((p) => p.id === playerId);

      await supabase
        .from("players")
        .update({ chips: player.chips + payout })
        .eq("id", playerId);
    }

    const allWinners = Object.keys(payouts).map((playerId) => {
      const player = players.find((p) => p.id === playerId);

      const winningPot = potResults.find((pot) =>
        pot.winners.some((winner) => winner.player_id === playerId)
      );

      const winnerInfo = winningPot?.winners.find(
        (winner) => winner.player_id === playerId
      );

      return {
        player_id: playerId,
        username: player.username,
        payout: payouts[playerId],
        hand_name: winnerInfo?.hand_name || "Winning hand",
      };
    });

    const handSummary = allWinners
      .map((winner) => `${winner.username}: ${winner.hand_name}`)
      .join(" | ");

    const result = {
      winners: allWinners,
      pots: potResults,
      totalPot: potOverride ?? game.pot ?? 0,
      message: allWinners
        .map((winner) => `${winner.username} wins ${formatChips(winner.payout)}`)
        .join(" | "),
      handSummary,
    };

    const { error } = await supabase
      .from("games")
      .update({
        community_cards: finalCommunityCards,
        phase: "showdown",
        current_bet: 0,
        current_turn_seat: null,
        round_closer_seat: null,
        last_raiser_seat: null,
        game_result: result,
        pot_awarded: true,
        pot: 0,
      })
      .eq("id", game.id);

    if (error) {
      setError(error.message);
      return;
    }

    await addLog(result.message);
    await loadPlayers(room.id);
    await loadGame(room.id);
    await loadHands(game.id);
  }

  async function runOutBoardAndShowdown(potOverride = null, handsOverride = null) {
    if (!game) return;

    const deck = [...(game.deck || [])];
    const finalCommunityCards = [...(game.community_cards || [])];

    while (finalCommunityCards.length < 5) {
      finalCommunityCards.push(deck.shift());
    }

    await showdownAndAward(finalCommunityCards, potOverride, handsOverride);
  }

  async function forceShowdown(handsOverride = null) {
    await showdownAndAward(game?.community_cards || [], game?.pot || 0, handsOverride);
  }

  async function advanceStreet(potOverride = null, handsOverride = null) {
    if (!game) return;

    const deck = [...(game.deck || [])];
    let newCommunityCards = [...(game.community_cards || [])];
    let newPhase = game.phase;
    const handsForAdvance = handsOverride || hands;

    if (game.phase === "preflop") {
      newCommunityCards = deck.splice(0, 3);
      newPhase = "flop";
      await addLog("Flop dealt");
    } else if (game.phase === "flop") {
      newCommunityCards = [...newCommunityCards, deck.shift()];
      newPhase = "turn";
      await addLog("Turn dealt");
    } else if (game.phase === "turn") {
      newCommunityCards = [...newCommunityCards, deck.shift()];
      newPhase = "river";
      await addLog("River dealt");
    } else if (game.phase === "river") {
      await showdownAndAward(newCommunityCards, potOverride, handsForAdvance);
      return;
    }

    await supabase.from("player_hands").update({ current_bet: 0 }).eq("game_id", game.id);

    if (shouldGoStraightToShowdown(handsForAdvance, 0)) {
      await runOutBoardAndShowdown(potOverride, handsForAdvance);
      return;
    }

    const blindSeats = getBlindSeats(players);
    const firstPostflopSeat = getFirstActiveFromSeat(blindSeats.firstPostflopSeat, handsForAdvance);
    const roundCloserSeat = getPreviousActiveSeat(firstPostflopSeat, handsForAdvance);

    const { error } = await supabase
      .from("games")
      .update({
        deck,
        community_cards: newCommunityCards,
        phase: newPhase,
        current_bet: 0,
        current_turn_seat: firstPostflopSeat,
        round_closer_seat: roundCloserSeat,
        last_raiser_seat: null,
      })
      .eq("id", game.id);

    if (error) setError(error.message);

    await loadGame(room.id);
    await loadHands(game.id);
  }

  async function finishAction() {
    if (!game || !currentPlayer) return;

    if (countActivePlayers() <= 1) {
      await forceShowdown();
      return;
    }

    if (shouldGoStraightToShowdown(hands, game.current_bet)) {
      await runOutBoardAndShowdown();
      return;
    }

    if (currentPlayer.seat_number === game.round_closer_seat) {
      await advanceStreet();
      return;
    }

    const nextSeat = getNextActiveSeat(currentPlayer.seat_number);

    const { error } = await supabase
      .from("games")
      .update({ current_turn_seat: nextSeat })
      .eq("id", game.id);

    if (error) setError(error.message);
    await loadGame(room.id);
  }

  async function updateBet(extraAmount, newCurrentBet) {
    if (!game || !currentPlayer || !myGameHand) return;

    const actualAmount = Math.min(extraAmount, currentPlayer.chips);
    const updatedPlayerChips = currentPlayer.chips - actualAmount;
    const updatedHandBet = (myGameHand.current_bet || 0) + actualAmount;
    const updatedTotalCommitted = (myGameHand.total_committed || 0) + actualAmount;
    const updatedPot = (game.pot || 0) + actualAmount;
    const isAllIn = updatedPlayerChips === 0;

    const increasedBet = newCurrentBet > game.current_bet;
    const wasFullRaise = increasedBet && actualAmount >= minimumRaise;

    let nextSeat = getNextActiveSeat(currentPlayer.seat_number);
    let roundCloserSeat = game.round_closer_seat;
    let lastRaiserSeat = game.last_raiser_seat;
    let tableCurrentBet = increasedBet ? newCurrentBet : game.current_bet;

    if (wasFullRaise) {
      lastRaiserSeat = currentPlayer.seat_number;
      roundCloserSeat = getPreviousActiveSeat(currentPlayer.seat_number);
    }

    const { error: playerError } = await supabase
      .from("players")
      .update({ chips: updatedPlayerChips })
      .eq("id", currentPlayer.id);

    if (playerError) {
      setError(playerError.message);
      return;
    }

    const { data: updatedHand, error: handError } = await supabase
      .from("player_hands")
      .update({
        current_bet: updatedHandBet,
        total_committed: updatedTotalCommitted,
        all_in: isAllIn,
      })
      .eq("game_id", game.id)
      .eq("player_id", currentPlayer.id)
      .select()
      .single();

    if (handError) {
      setError(handError.message);
      return;
    }

    const updatedHands = hands.map((hand) => hand.id === updatedHand.id ? updatedHand : hand);

    const logMessage = isAllIn
      ? `${currentPlayer.username} goes all in for ${formatChips(actualAmount)}`
      : increasedBet
      ? `${currentPlayer.username} raises to ${formatChips(newCurrentBet)}`
      : `${currentPlayer.username} calls ${formatChips(actualAmount)}`;

    await addLog(logMessage);

    if (countActivePlayers(updatedHands) <= 1) {
      await supabase.from("games").update({ pot: updatedPot }).eq("id", game.id);
      await forceShowdown(updatedHands);
      return;
    }

    if (shouldGoStraightToShowdown(updatedHands, tableCurrentBet)) {
      await supabase.from("games").update({ pot: updatedPot }).eq("id", game.id);
      await runOutBoardAndShowdown(updatedPot, updatedHands);
      return;
    }

    if (!wasFullRaise && currentPlayer.seat_number === game.round_closer_seat) {
      await supabase.from("games").update({ pot: updatedPot }).eq("id", game.id);
      await advanceStreet(updatedPot, updatedHands);
      return;
    }

    const { error: gameError } = await supabase
      .from("games")
      .update({
        pot: updatedPot,
        current_bet: tableCurrentBet,
        current_turn_seat: nextSeat,
        round_closer_seat: roundCloserSeat,
        last_raiser_seat: lastRaiserSeat,
      })
      .eq("id", game.id);

    if (gameError) {
      setError(gameError.message);
      return;
    }

    setBetAmount(0);
    await loadPlayers(room.id);
    await loadGame(room.id);
    await loadHands(game.id);
  }

  async function callBet() {
    setError("");

    if (!isMyTurn) {
      setError("It is not your turn.");
      return;
    }

    if (amountToCall <= 0) {
      setError("There is nothing to call. Use check.");
      return;
    }

    const callAmount = Math.min(amountToCall, currentPlayer.chips);
    await updateBet(callAmount, game.current_bet);
  }

  async function raiseBet() {
    setError("");

    if (!isMyTurn) {
      setError("It is not your turn.");
      return;
    }

    if (Number(betAmount) < minimumRaise) {
      setError(`Minimum raise is ${formatChips(minimumRaise)}.`);
      return;
    }

    if (Number(betAmount) > currentPlayer.chips) {
      setError("You do not have enough chips.");
      return;
    }

    const newCurrentBet = (myGameHand?.current_bet || 0) + Number(betAmount);
    await updateBet(Number(betAmount), newCurrentBet);
  }

  async function allIn() {
    setError("");

    if (!isMyTurn) {
      setError("It is not your turn.");
      return;
    }

    if (currentPlayer.chips <= 0) {
      setError("You have no chips left.");
      return;
    }

    const allInAmount = currentPlayer.chips;
    const possibleNewBet = (myGameHand?.current_bet || 0) + allInAmount;
    await updateBet(allInAmount, possibleNewBet);
  }

  async function check() {
    setError("");

    if (!isMyTurn) {
      setError("It is not your turn.");
      return;
    }

    if (amountToCall > 0) {
      setError(`You must call ${formatChips(amountToCall)} or fold.`);
      return;
    }

    await addLog(`${currentPlayer.username} checks`);
    await finishAction();
  }

  async function fold() {
    setError("");

    if (!isMyTurn) {
      setError("It is not your turn.");
      return;
    }

    const { data: updatedHand, error: foldError } = await supabase
      .from("player_hands")
      .update({ folded: true })
      .eq("game_id", game.id)
      .eq("player_id", currentPlayer.id)
      .select()
      .single();

    if (foldError) {
      setError(foldError.message);
      return;
    }

    await addLog(`${currentPlayer.username} folds`);

    const updatedHands = hands.map((h) => h.id === updatedHand.id ? updatedHand : h);

    if (countActivePlayers(updatedHands) <= 1) {
      await forceShowdown(updatedHands);
      return;
    }

    if (shouldGoStraightToShowdown(updatedHands, game.current_bet)) {
      await runOutBoardAndShowdown(game.pot, updatedHands);
      return;
    }

    if (currentPlayer.seat_number === game.round_closer_seat) {
      await advanceStreet(game.pot, updatedHands);
      return;
    }

    const nextSeat = getNextActiveSeat(currentPlayer.seat_number, updatedHands);

    const { error: gameError } = await supabase
      .from("games")
      .update({ current_turn_seat: nextSeat })
      .eq("id", game.id);

    if (gameError) setError(gameError.message);

    await loadGame(room.id);
    await loadHands(game.id);
  }

  async function leaveRoom() {
    clearSession();
    setScreen("home");
    setRoom(null);
    setGame(null);
    setCurrentPlayer(null);
    setPlayers([]);
    setHands([]);
    setLogs([]);
    setChipRequests([]);
    setMyHand([]);
  }

  useEffect(() => {
    async function restoreSession() {
      const saved = localStorage.getItem("pokerSession");
      if (!saved) return;

      try {
        const session = JSON.parse(saved);

        const { data: roomData } = await supabase
          .from("rooms")
          .select("*")
          .eq("id", session.roomId)
          .single();

        const { data: playerData } = await supabase
          .from("players")
          .select("*")
          .eq("id", session.playerId)
          .single();

        if (!roomData || !playerData) {
          clearSession();
          return;
        }

        setRoom(roomData);
        setCurrentPlayer(playerData);
        setRoomCode(roomData.room_code);
        await loadPlayers(roomData.id);
        await loadGame(roomData.id);
        await loadLogs(roomData.id);
        await loadChipRequests(roomData.id);
        setScreen("table");
      } catch {
        clearSession();
      }
    }

    restoreSession();
  }, []);

  useEffect(() => {
    if (!room?.id) return;

    loadPlayers(room.id);
    loadRoom(room.id);
    loadGame(room.id);
    loadLogs(room.id);
    loadChipRequests(room.id);

    const interval = setInterval(() => {
      loadPlayers(room.id);
      loadRoom(room.id);
      loadGame(room.id);
      loadLogs(room.id);
      loadChipRequests(room.id);
    }, 1000);

    return () => clearInterval(interval);
  }, [room?.id]);

  useEffect(() => {
    if (!game?.id || !currentPlayer?.id) return;

    loadMyHand(game.id, currentPlayer.id);
    loadHands(game.id);

    const interval = setInterval(() => {
      loadMyHand(game.id, currentPlayer.id);
      loadHands(game.id);
    }, 1000);

    return () => clearInterval(interval);
  }, [game?.id, currentPlayer?.id]);

  useEffect(() => {
    if (room?.status === "playing" && game?.phase !== "showdown") {
      setBetAmount(Math.min(minimumRaise, maxBet));
    }
  }, [minimumRaise, maxBet, room?.status, game?.phase]);

  useEffect(() => {
    if (!game?.current_turn_seat) return;

    setTurnTimer(TURN_SECONDS);

    if (
      game.current_turn_seat === currentPlayer?.seat_number &&
      lastTurnRef.current !== game.current_turn_seat + "-" + game.phase
    ) {
      playTurnAlert();
      lastTurnRef.current = game.current_turn_seat + "-" + game.phase;
    }
  }, [game?.current_turn_seat, game?.phase, currentPlayer?.seat_number]);

  useEffect(() => {
    if (!isMyTurn) return;

    const interval = setInterval(() => {
      setTurnTimer((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          if (amountToCall > 0) fold();
          else check();
          return TURN_SECONDS;
        }

        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isMyTurn, amountToCall, game?.id]);

  useEffect(() => {
    if (game?.phase !== "showdown") {
      setShowdownCountdown(null);
      setShowShowdownReveal(false);
      return;
    }

    setShowShowdownReveal(false);
    setShowdownCountdown(3);

    let count = 3;

    const interval = setInterval(() => {
      count -= 1;

      if (count <= 0) {
        clearInterval(interval);
        setShowdownCountdown(null);
        setShowShowdownReveal(true);
        return;
      }

      setShowdownCountdown(count);
    }, 1000);

    return () => clearInterval(interval);
  }, [game?.id, game?.phase]);

  if (screen === "home") {
    return (
      <div className="page">
        <div className="card">
          <h1>Lads Poker Night</h1>
          <p>Prepare for Fin to win all your money</p>

          <input placeholder="Your username" value={username} onChange={(e) => setUsername(e.target.value)} />

          <input
            type="number"
            step="0.01"
            placeholder="Buy-in value e.g. 6.40"
            value={buyInValue}
            onChange={(e) => setBuyInValue(e.target.value)}
          />

          <input
            type="number"
            step="0.01"
            placeholder="Small blind e.g. 0.05"
            value={smallBlind}
            onChange={(e) => setSmallBlind(e.target.value)}
          />

          <input
            type="number"
            step="0.01"
            placeholder="Big blind e.g. 0.10"
            value={bigBlind}
            onChange={(e) => setBigBlind(e.target.value)}
          />

          <button onClick={createRoom}>Create Room</button>

          <div className="divider">or</div>

          <input placeholder="Room code" value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} />

          <button onClick={joinRoom}>Join Room</button>

          {error && <p className="error">{error}</p>}
        </div>
      </div>
    );
  }

  const displayPlayers = getDisplayPlayers();
  const isShowdown = game?.phase === "showdown";
  const canRevealShowdown = isShowdown && showShowdownReveal;

  const chipLeader = players.reduce((best, player) => {
    if (!best) return player;
    return Number(player.chips || 0) > Number(best.chips || 0) ? player : best;
  }, null);

  const chipLeaderId = chipLeader?.id || null;

  return (
    <div className="tablePage compactTablePage">
      {isShowdown && !canRevealShowdown && showdownCountdown && (
        <div className="showdownCountdown">
          <h1>Showdown in</h1>
          <div>{showdownCountdown}</div>
        </div>
      )}

      {canRevealShowdown && game?.game_result && (
        <div className="winnerPopup">{game.game_result.message}</div>
      )}

      <div className="topLeftInfo sleekPanel">
        <h2>{room?.room_code}</h2>
        <p>{formatChips(room?.small_blind)}/{formatChips(room?.big_blind)} blinds</p>
      </div>

      <div className="topRightActions">
        {currentPlayer?.is_host && game?.phase === "showdown" && (
          <button className="smallTopButton" onClick={nextRound}>Next Round</button>
        )}

        {currentPlayer?.is_host && (
          <button className="smallTopButton" onClick={resetRoom}>Reset</button>
        )}

        <button className="smallTopButton" onClick={leaveRoom}>Leave</button>
      </div>
<div className="chatDock sleekPanel">
  <div className="chatMessages">
    {chatMessages.length === 0 ? (
      <p className="emptyChat">No messages yet.</p>
    ) : (
      chatMessages.map((msg) => {
        const isWhisper = msg.visible_to && msg.visible_to.length > 0;

        return (
          <div key={msg.id} className={isWhisper ? "chatMessage whisperMessage" : "chatMessage"}>
            <strong>
              {msg.sender_name}
              {isWhisper ? " whispered" : ""}
            </strong>
            <span>{msg.message}</span>
          </div>
        );
      })
    )}
  </div>

  <div className="whisperRow">
    <span>Whisper:</span>

    {players
      .filter((player) => player.id !== currentPlayer?.id)
      .map((player) => (
        <button
          key={player.id}
          type="button"
          className={whisperTo.includes(player.id) ? "whisperChip selected" : "whisperChip"}
          onClick={() => toggleWhisperPlayer(player.id)}
        >
          {player.username}
        </button>
      ))}
  </div>

  <div className="chatInputRow">
    <input
      value={chatInput}
      placeholder={
        whisperTo.length > 0
          ? "Whisper message..."
          : "Talk shit..."
      }
      onChange={(e) => setChatInput(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") sendChatMessage();
      }}
    />

    <button onClick={sendChatMessage}>Send</button>
  </div>
</div>
      {!isShowdown && room?.status === "playing" && (
        <div className="topCenterStatus sleekPanel">
          <p><strong>{currentTurnPlayer?.username || "..."}</strong>'s turn</p>
          <p>
            {game?.phase} · Pot {formatChips(game?.pot || 0)} · Call{" "}
            {formatChips(amountToCall)}
          </p>
          {isMyTurn && <p className="yourTurnText">Your turn · {turnTimer}s</p>}
        </div>
      )}

      {canRevealShowdown && game?.game_result && (
        <div className="resultBox sleekPanel">
          <h3>Round Complete</h3>
          <p>{game.game_result.message}</p>

          {game.game_result.handSummary && (
            <p className="winnerHandSummary">{game.game_result.handSummary}</p>
          )}

          {currentPlayer?.is_host && (
            <button onClick={nextRound}>Next Round</button>
          )}
        </div>
      )}

      {room?.status === "waiting" && (
        <div className="lobbyBox sleekPanel">
          <h2>Waiting Lobby</h2>
          <p>{players.length} player(s)</p>

          {currentPlayer?.is_host ? (
            <button onClick={startGame}>Start Game</button>
          ) : (
            <p>Waiting for host...</p>
          )}

          {error && <p className="error">{error}</p>}
        </div>
      )}

      <div className="pokerTable compactPokerTable">
        <div className="communityCards">
          {[0, 1, 2, 3, 4].map((index) => {
            const card = game?.community_cards?.[index];
            return <CardView key={index} card={card} />;
          })}
        </div>

        {room?.status === "playing" && (
          <div className="potChipPile">
            <ChipStack amount={game?.pot || 0} />
            <span>{formatChips(game?.pot || 0)}</span>
          </div>
        )}

        {displayPlayers.map((player, index) => {
          const hand = hands.find((h) => h.player_id === player.id);
          const seatClass = getTableSeatClass(index, displayPlayers.length);
          const roleLabel = getRoleLabel(player);
          const chipOrientation = isSideSeat(seatClass) ? "vertical" : "horizontal";

          return (
            <div
              key={player.id}
              className={`player compactPlayer ${seatClass} ${
                player.seat_number === game?.current_turn_seat ? "activePlayer" : ""
              } ${hand?.folded ? "foldedPlayer" : ""}`}
            >
              <div className="avatar compactAvatar">
                {player.avatar}
                {player.id === chipLeaderId && Number(player.chips || 0) > 0 && (
                  <span className="chipLeaderCrown">👑</span>
                )}
              </div>

              <div className="playerCompactText">
                {player.username} {formatChips(player.chips)}
                {roleLabel ? ` (${roleLabel})` : ""}
              </div>

              <div className={`tableEdgeChipStack ${seatClass}`}>
                <ChipStack amount={player.chips} orientation={chipOrientation} />
              </div>

              {canRevealShowdown && hand?.cards && (
                <div className="revealedCards compactReveal">
                  {hand.cards.map((card, cardIndex) => (
                    <CardView key={cardIndex} card={card} small />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="leftLogDock sleekPanel">
        <h3>Log</h3>
        {logs.length === 0 ? (
          <p>No actions yet.</p>
        ) : (
          logs.slice(0, 6).map((log) => <p key={log.id}>{log.message}</p>)
        )}
      </div>

      <div className="chipRequestDock sleekPanel">
        <h3>{currentPlayer?.is_host ? "Chip Controls" : "Need chips?"}</h3>

        <div className="chipRequestRow">
          <input
            type="number"
            step="0.01"
            value={requestAmount}
            onChange={(e) => setRequestAmount(e.target.value)}
          />

          {currentPlayer?.is_host ? (
            <button onClick={topUpSelf}>Top Up Me</button>
          ) : (
            <button onClick={requestMoreChips}>Request</button>
          )}
        </div>

        {currentPlayer?.is_host && (
          <div className="hostRequestsSection">
            <h4>Pending Requests</h4>

            {chipRequests.length === 0 ? (
              <p>No pending requests.</p>
            ) : (
              chipRequests.map((request) => (
                <div key={request.id} className="hostRequestCard">
                  <span>
                    {request.player_name} wants {formatChips(request.amount)}
                  </span>

                  <div className="hostRequestButtons">
                    <button onClick={() => approveChipRequest(request)}>Approve</button>
                    <button onClick={() => rejectChipRequest(request)}>Reject</button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {room?.status === "playing" && !isShowdown && (
        <div className="bottomDock sleekPanel">
          <div className="bottomHandSection">
            <div className="bottomLabel">Your Hand</div>
            <div className="handCards">
              {myHand.map((card, index) => (
                <CardView key={index} card={card} />
              ))}
            </div>
          </div>

          <div className="bottomControlsSection">
            <div className="actionButtonsRow">
              <button onClick={fold} disabled={!isMyTurn}>Fold</button>
              <button onClick={check} disabled={!isMyTurn || amountToCall > 0}>Check</button>
              <button onClick={callBet} disabled={!isMyTurn || amountToCall <= 0}>Call</button>
              <button onClick={raiseBet} disabled={!isMyTurn}>Raise</button>
              <button onClick={allIn} disabled={!isMyTurn}>All In</button>
            </div>

            <div className="sliderRow">
              <span>Bet</span>
              <input
                type="range"
                min="0"
                max={maxBet}
                step="5"
                value={betAmount}
                onChange={(e) => setBetAmount(Number(e.target.value))}
              />
              <span>{formatChips(betAmount)}</span>
            </div>

            <div className="bottomInfoRow">
              <span>Call: {formatChips(amountToCall)}</span>
              <span>Min raise: {formatChips(minimumRaise)}</span>
            </div>
          </div>
        </div>
      )}

      {error && screen === "table" && (
        <div className="tableError">{error}</div>
      )}
    </div>
  );
}

export default App;
