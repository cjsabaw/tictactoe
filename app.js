const SUPABASE_URL = 'https://hoetwrisqzjeyumebvov.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KaLzRUzIktp3ljn4iWDszQ_Zo-tZ_e5';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentMatchId = null;
let username = "";
let currentTurn = "";

const joinBtn = document.getElementById('join-btn');
const statusText = document.getElementById('status');
const gridElement = document.getElementById('grid');

// 1. Initialize the 3x3 Grid on page load
for (let i = 0; i < 9; i++) {
    const cell = document.createElement('div');
    cell.classList.add('cell');
    cell.dataset.index = i;
    cell.addEventListener('click', () => makeMove(i));
    gridElement.appendChild(cell);
}

// 2. Matchmaking Logic
joinBtn.addEventListener('click', async () => {
    username = document.getElementById('username').value;
    if (!username) return alert("Enter a username");

    statusText.innerText = "Searching for a match...";

    const { data: openMatches } = await supabaseClient
        .from('matches')
        .select('*')
        .eq('status', 'waiting')
        .is('player_2', null)
        .order('created_at', { ascending: true })
        .limit(1);

    if (openMatches && openMatches.length > 0) {
        const match = openMatches[0];
        currentMatchId = match.id;

        await supabaseClient.from('matches').update({
            player_2: username,
            status: 'playing',
            current_turn: match.player_1 // Player 1 always starts
        }).eq('id', currentMatchId);

        startGame();
    } else {
        currentMatchId = `room-${Math.floor(Math.random() * 10000)}`;
        await supabaseClient.from('matches').insert({
            id: currentMatchId,
            player_1: username,
            status: 'waiting',
            current_turn: username,
            game_state: {}
        });

        statusText.innerText = "Waiting for an opponent...";
        startGame();
    }
});

// 3. Game Lifecycle
async function startGame() {
    document.getElementById('setup-container').classList.add('hidden');
    document.getElementById('game-container').classList.remove('hidden');

    const { data: match } = await supabaseClient
        .from('matches').select('*').eq('id', currentMatchId).single();

    if (match) updateUI(match);
    subscribeToMatch();
}

async function makeMove(index) {
    const { data: match } = await supabaseClient
        .from('matches').select('*').eq('id', currentMatchId).single();

    // Validations: Is game active? Is it my turn? Is cell empty?
    if (match.status !== 'playing' || match.current_turn !== username || match.game_state[index]) {
        return;
    }

    let newState = match.game_state || {};
    newState[index] = (username === match.player_1) ? "X" : "O";

    const winnerSymbol = checkWinner(newState);
    const nextTurn = (username === match.player_1) ? match.player_2 : match.player_1;

    let updateData = {
        game_state: newState,
        current_turn: nextTurn
    };

    if (winnerSymbol) {
        updateData.status = 'finished';
        updateData.winner = (winnerSymbol === 'draw') ? 'draw' : username;
    }

    await supabaseClient.from('matches').update(updateData).eq('id', currentMatchId);
}

// 4. Realtime Sync & UI Updates
function subscribeToMatch() {
    supabaseClient
        .channel(`match_${currentMatchId}`)
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'matches',
            filter: `id=eq.${currentMatchId}`
        }, (payload) => {
            updateUI(payload.new);
        })
        .subscribe();
}

function updateUI(match) {
    currentTurn = match.current_turn;
    renderBoard(match.game_state);

    if (match.status === 'playing') {
        gridElement.classList.remove('disabled');
        statusText.innerText = (currentTurn === username) ? "Your Turn!" : `Waiting for ${currentTurn}...`;
    } else if (match.status === 'finished') {
        gridElement.classList.add('disabled');

        // Handle Game Over UI
        const winSymbol = checkWinner(match.game_state);
        if (winSymbol === 'draw') {
            statusText.innerHTML = "It's a Draw! <button onclick='location.reload()'>Find New Match</button>";
        } else {
            const mySymbol = (username === match.player_1) ? "X" : "O";
            const resultText = (winSymbol === mySymbol) ? "You Won! " : "You Lost! ";
            statusText.innerHTML = `${resultText} <button onclick='location.reload()'>Find New Match</button>`;
        }
    } else {
        gridElement.classList.add('disabled');
        statusText.innerText = "Waiting for an opponent...";
    }
}

function renderBoard(state) {
    const cells = document.querySelectorAll('.cell');
    cells.forEach(c => c.innerText = "");
    if (!state) return;
    Object.keys(state).forEach(index => {
        if (cells[index]) cells[index].innerText = state[index];
    });
}

function checkWinner(state) {
    const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];
    for (let line of lines) {
        const [a, b, c] = line;
        if (state[a] && state[a] === state[b] && state[a] === state[c]) return state[a];
    }
    return Object.keys(state).length === 9 ? 'draw' : null;
}
