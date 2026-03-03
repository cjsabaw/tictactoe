const SUPABASE_URL = 'https://hoetwrisqzjeyumebvov.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KaLzRUzIktp3ljn4iWDszQ_Zo-tZ_e5';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentMatchId = null;
let username = "";
let myRole = ""; // 'player_1' or 'player_2'
let currentTurn = "";

const joinBtn = document.getElementById('join-btn');
const statusText = document.getElementById('status');

joinBtn.addEventListener('click', startMatchmaking);

async function startMatchmaking() {
    username = document.getElementById('username').value;
    if (!username) return alert("Enter a username");

    statusText.innerText = "Searching for a match...";

    // Find a match: 
    // 1. Status is 'waiting'
    // 2. Player_2 is empty
    // 3. ORDER by created_at (ascending) to get the oldest one first
    const { data: openMatches, error } = await supabaseClient
        .from('matches')
        .select('*')
        .eq('status', 'waiting')
        .is('player_2', null)
        .order('created_at', { ascending: true })
        .limit(1);

    if (openMatches && openMatches.length > 0) {
        const match = openMatches[0];
        currentMatchId = match.id;
        myRole = "player_2";

        await supabaseClient
            .from('matches')
            .update({
                player_2: username,
                status: 'playing',
                current_turn: match.player_1 // Player 1 starts
            })
            .eq('id', currentMatchId);

        startGame();
    } else {
        // No match found, create a new room
        currentMatchId = `room-${Math.floor(Math.random() * 10000)}`;
        myRole = "player_1";

        await supabaseClient
            .from('matches')
            .insert({
                id: currentMatchId,
                player_1: username,
                status: 'waiting',
                current_turn: username,
                game_state: {}
            });

        statusText.innerText = "Waiting for an opponent...";
        startGame();
    }
}

async function makeMove(index) {
    if (currentTurn !== username) return;

    const { data: match } = await supabaseClient
        .from('matches')
        .select('*')
        .eq('id', currentMatchId)
        .single();

    if (match.status === 'finished') return; // Prevent moves after game ends

    let newState = match.game_state || {};

    if (!newState[index]) {
        newState[index] = username.substring(0, 1).toUpperCase();

        const winnerSymbol = checkWinner(newState);
        let finalStatus = 'playing';
        let winningPlayer = null;

        if (winnerSymbol === 'draw') {
            finalStatus = 'finished';
        } else if (winnerSymbol) {
            finalStatus = 'finished';
            winningPlayer = username; // The person who just moved won
        }

        const nextTurn = (username === match.player_1) ? match.player_2 : match.player_1;

        await supabaseClient
            .from('matches')
            .update({
                game_state: newState,
                current_turn: nextTurn,
                status: finalStatus,
                winner: winningPlayer // You'll need to add this column to DB
            })
            .eq('id', currentMatchId);
    }
}


async function startGame() {
    document.getElementById('setup-container').classList.add('hidden');
    document.getElementById('game-container').classList.remove('hidden');

    // 1. Immediately fetch the LATEST data from the DB 
    // This catches the case where Player 2 joined while we were loading.
    const { data: match } = await supabaseClient
        .from('matches')
        .select('*')
        .eq('id', currentMatchId)
        .single();

    if (match) {
        updateUI(match);
    }

    // 2. Then start listening for future changes
    subscribeToMatch();
}

function subscribeToMatch() {
    supabaseClient
        .channel(`match_${currentMatchId}`)
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'matches',
            filter: `id=eq.${currentMatchId}`
        }, (payload) => {
            const match = payload.new;
            currentTurn = match.current_turn; // Sync the turn locally

            if (match.status === 'playing') {
                statusText.innerText = (currentTurn === username)
                    ? "Your Turn!"
                    : `Waiting for ${currentTurn}...`;
                renderBoard(match.game_state);
            }
        })
        .subscribe();
}

function updateUI(match) {
    currentTurn = match.current_turn;

    if (match.status === 'finished') {
        const board = match.game_state;
        const winner = checkWinner(board);

        if (winner === 'draw') {
            statusText.innerHTML = "It's a Draw! <button onclick='location.reload()'>Find New Match</button>";
        } else {
            const resultText = (winner === username.substring(0, 1).toUpperCase()) ? "You Won " : "You Lost! ";
            statusText.innerHTML = `${resultText} <button onclick='location.reload()'>Find New Match</button>`;
        }
        renderBoard(match.game_state);
    } else if (match.status === 'playing') {
        statusText.innerText = (currentTurn === username) ? "Your Turn!" : `Waiting for ${currentTurn}...`;
        renderBoard(match.game_state);
    } else {
        statusText.innerText = "Waiting for an opponent...";
    }
}

// Then update your subscription to use it:
function subscribeToMatch() {
    supabaseClient
        .channel(`match_${currentMatchId}`)
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'matches',
            filter: `id=eq.${currentMatchId}`
        }, (payload) => {
            updateUI(payload.new); // Call the helper here
        })
        .subscribe();
}

// Initialize the 3x3 Grid on page load
const grid = document.getElementById('grid');
for (let i = 0; i < 9; i++) {
    const cell = document.createElement('div');
    cell.classList.add('cell');
    cell.dataset.index = i;
    cell.addEventListener('click', () => makeMove(i));
    grid.appendChild(cell);
}

// Render the board based on the game_state JSON from Supabase
function renderBoard(state) {
    const cells = document.querySelectorAll('.cell');
    // Clear all cells first
    cells.forEach(c => c.innerText = "");

    // state looks like { "0": "A", "4": "B" }
    if (!state) return;

    Object.keys(state).forEach(index => {
        if (cells[index]) {
            cells[index].innerText = state[index];
        }
    });
}   

function checkWinner(state) {
    const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
        [0, 4, 8], [2, 4, 6]             // Diagonals
    ];

    for (let line of lines) {
        const [a, b, c] = line;
        if (state[a] && state[a] === state[b] && state[a] === state[c]) {
            return state[a]; // Returns the letter of the winner ('A', 'B', etc.)
        }
    }

    // Check for Draw (if all 9 cells are filled and no winner)
    if (Object.keys(state).length === 9) return 'draw';

    return null;
}