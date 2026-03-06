// Global state
let currentSnippetId = null;
let currentGoalId = null;
let currentReflectionId = null;
let currentWeekStart = null;
let currentWeekEnd = null;
let currentModalType = null; // 'snippet', 'goal', or 'reflection'
let goalsEnabled = true; // Default to true, will be updated from server
let reflectionsEnabled = true; // Default to true, will be updated from server
let dailyScoresEnabled = true; // Default to true, will be updated from server
let fitnessEnabled = true; // Default to true, will be updated from server
let currentEndeavor = 'pet project'; // Current active endeavor
let endeavorsCache = []; // Cache of all endeavors
let githubAutofillEndeavor = ''; // Endeavor for which GitHub autofill is enabled (empty = disabled)
let currentView = 'endeavors'; // 'endeavors' or 'fitness'
let fitnessHabits = []; // Cache of fitness habits
let fitnessTracking = {}; // Cache of fitness tracking data

// Initialize the app
document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    initializeDefaultView();
    setupDateInputs();
});

async function loadConfig() {
    try {
        const response = await fetch('/api/config');
        const config = await response.json();
        goalsEnabled = config.goals_enabled;
        reflectionsEnabled = config.reflections_enabled;
        dailyScoresEnabled = config.daily_scores_enabled;
        fitnessEnabled = config.fitness_enabled;
        githubAutofillEndeavor = config.github_autofill_endeavor || '';
    } catch (error) {
        console.error('Error loading config:', error);
        // Default to true if config fails to load
        goalsEnabled = true;
        reflectionsEnabled = true;
        dailyScoresEnabled = true;
        fitnessEnabled = true;
    }
}

function setupDateInputs() {
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');

    // When start changes: ensure it's a Monday (snap to Monday), and that end >= start
    startInput.addEventListener('change', () => {
        if (!startInput.value) return;
        const selected = new Date(startInput.value);
        const monday = getWeekDates(selected).monday;
        startInput.value = monday; // snap to Monday

        if (endInput.value) {
            const endDate = new Date(endInput.value);
            if (endDate < new Date(startInput.value)) {
                alert('End date must be greater than or equal to start date. Adjusting end to the Sunday of the selected week.');
                endInput.value = getWeekDates(new Date(startInput.value)).sunday;
            }
        }

        if (currentView === 'endeavors') {
            loadSnippets();
        } else {
            loadFitnessView();
        }
    });

    // When end changes: ensure it's a Sunday (snap to Sunday), and that end >= start
    endInput.addEventListener('change', () => {
        if (!endInput.value) return;
        const selected = new Date(endInput.value);
        const sunday = getWeekDates(selected).sunday;
        endInput.value = sunday; // snap to Sunday

        if (startInput.value) {
            const startDate = new Date(startInput.value);
            if (new Date(endInput.value) < startDate) {
                alert('End date must be greater than or equal to start date. Adjusting start to the Monday of the selected week.');
                startInput.value = getWeekDates(new Date(endInput.value)).monday;
            }
        }

        if (currentView === 'endeavors') {
            loadSnippets();
        } else {
            loadFitnessView();
        }
    });
}

function getWeekDates(date) {
    // Normalize input to local date (avoid TZ issues with Date parsing of YYYY-MM-DD)
    let d;
    if (typeof date === 'string') {
        const parts = date.split('-').map(Number);
        // parts: [YYYY, MM, DD]
        d = new Date(parts[0], parts[1] - 1, parts[2]);
    } else if (date instanceof Date) {
        d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    } else {
        d = new Date();
        d.setHours(0,0,0,0);
    }

    const day = d.getDay(); // 0 (Sun) .. 6 (Sat)
    // Calculate Monday of this week
    const monday = new Date(d);
    const offsetToMonday = (day === 0) ? -6 : (1 - day);
    monday.setDate(d.getDate() + offsetToMonday);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    return {
        monday: formatDate(monday),
        sunday: formatDate(sunday),
        mondayObj: monday,
        sundayObj: sunday
    };
}

function formatDate(date) {
    // Format YYYY-MM-DD using local date components to avoid timezone shifts
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatDateDisplay(dateStr) {
    // Parse YYYY-MM-DD into local date to avoid timezone issues
    const parts = String(dateStr).split('-').map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function getWeekNumber(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

async function initializeDefaultView() {
    // Check URL for parameters
    const urlParams = new URLSearchParams(window.location.search);
    const endeavorParam = urlParams.get('endeavor');
    const startDateParam = urlParams.get('start_date');
    const endDateParam = urlParams.get('end_date');

    // Set current endeavor from URL or default to 'pet project'
    currentEndeavor = endeavorParam || 'pet project';

    // Load endeavors and render tabs
    await loadEndeavors();

    // Default date range per spec:
    // Start = Monday of (current week - 4 weeks)
    // End   = Sunday of current week
    const today = new Date();

    // Get current week's Monday and Sunday
    const currentWeek = getWeekDates(today);

    // Compute Monday of current week minus 4 weeks
    const startMondayObj = new Date(currentWeek.mondayObj);
    startMondayObj.setDate(startMondayObj.getDate() - (4 * 7));

    // start = Monday of (current week - 4 weeks)
    const startStr = formatDate(startMondayObj);
    // end = Sunday of current week
    const endStr = currentWeek.sunday;

    // Use URL params if available, otherwise use defaults
    document.getElementById('startDate').value = startDateParam || startStr;
    document.getElementById('endDate').value = endDateParam || endStr;

    await loadSnippets();
}

async function goToCurrentWeek() {
    // Set date range to default view:
    // Start = Monday of (current week - 4 weeks)
    // End   = Sunday of current week
    const today = new Date();

    // Get current week's Monday and Sunday
    const currentWeek = getWeekDates(today);

    // Compute Monday of current week minus 4 weeks
    const startMondayObj = new Date(currentWeek.mondayObj);
    startMondayObj.setDate(startMondayObj.getDate() - (4 * 7));

    // start = Monday of (current week - 4 weeks)
    const startStr = formatDate(startMondayObj);
    // end = Sunday of current week
    const endStr = currentWeek.sunday;

    document.getElementById('startDate').value = startStr;
    document.getElementById('endDate').value = endStr;

    await loadSnippets();
}

async function navigateWeek(direction) {
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');

    // Parse dates as local dates to avoid timezone issues
    const startParts = startInput.value.split('-').map(Number);
    const startDate = new Date(startParts[0], startParts[1] - 1, startParts[2]);

    const endParts = endInput.value.split('-').map(Number);
    const endDate = new Date(endParts[0], endParts[1] - 1, endParts[2]);

    // Move both dates forward/backward by a week
    startDate.setDate(startDate.getDate() + (direction * 7));
    endDate.setDate(endDate.getDate() + (direction * 7));

    // Update the inputs with the new dates
    startInput.value = formatDate(startDate);
    endInput.value = formatDate(endDate);

    if (currentView === 'endeavors') {
        await loadSnippets();
    } else {
        await loadFitnessView();
    }
}

async function loadSnippets() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    if (!startDate || !endDate) return;

    // Parse dates properly as local dates to avoid timezone issues
    const startParts = startDate.split('-').map(Number);
    const start = new Date(startParts[0], startParts[1] - 1, startParts[2]);

    const endParts = endDate.split('-').map(Number);
    const end = new Date(endParts[0], endParts[1] - 1, endParts[2]);

    if (end < start) {
        alert('End date must be greater than or equal to start date');
        return;
    }

    // Compute the universe of weeks (includes week containing start, week containing end, and all weeks between)
    const universe = computeUniverseWeeks(startDate, endDate);

    // Query API using full-week boundaries so server returns snippets for those weeks
    const queryStart = universe[0].week_start;
    const queryEnd = universe[universe.length - 1].week_end;

    try {
        // Load snippets, conditionally load daily scores, goals and reflections
        const endeavorParam = currentEndeavor ? `&endeavor=${encodeURIComponent(currentEndeavor)}` : '';
        const promises = [
            fetch(`/api/snippets?start_date=${queryStart}&end_date=${queryEnd}${endeavorParam}`)
        ];

        if (dailyScoresEnabled) {
            promises.push(fetch(`/api/daily_scores?start_date=${queryStart}&end_date=${queryEnd}${endeavorParam}`));
        }

        if (reflectionsEnabled) {
            promises.push(fetch(`/api/reflections?start_date=${queryStart}&end_date=${queryEnd}${endeavorParam}`));
        }

        if (goalsEnabled) {
            promises.push(fetch(`/api/goals?start_date=${queryStart}&end_date=${queryEnd}${endeavorParam}`));
        }

        const responses = await Promise.all(promises);
        const snippets = await responses[0].json();

        let dailyScores = [];
        let reflections = [];
        let goals = [];
        let responseIndex = 1;

        if (dailyScoresEnabled) {
            dailyScores = await responses[responseIndex].json();
            responseIndex++;
        }

        if (reflectionsEnabled) {
            reflections = await responses[responseIndex].json();
            responseIndex++;
        }

        if (goalsEnabled) {
            goals = await responses[responseIndex].json();
        }

        // Map snippets, reflections, and goals by week_start for easy lookup
        const snippetsMap = {};
        snippets.forEach(s => { snippetsMap[s.week_start] = s; });

        const reflectionsMap = {};
        if (reflectionsEnabled) {
            reflections.forEach(r => { reflectionsMap[r.week_start] = r; });
        }

        const goalsMap = {};
        if (goalsEnabled) {
            goals.forEach(g => { goalsMap[g.week_start] = g; });
        }

        // Map daily scores by date for easy lookup
        const scoresMap = {};
        dailyScores.forEach(s => { scoresMap[s.date] = s.score; });

        displayWeeks(universe, snippetsMap, goalsMap, reflectionsMap, scoresMap);
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

// Compute the array of weeks (week_start, week_end, Date objects, isFuture)
function computeUniverseWeeks(startDateStr, endDateStr) {
    // Parse dates as local dates to avoid timezone issues
    const startParts = startDateStr.split('-').map(Number);
    const startDate = new Date(startParts[0], startParts[1] - 1, startParts[2]);

    const endParts = endDateStr.split('-').map(Number);
    const endDate = new Date(endParts[0], endParts[1] - 1, endParts[2]);

    // Get Monday for start and Monday for end
    const startWeek = getWeekDates(startDate);
    const endWeek = getWeekDates(endDate);

    const weeks = [];
    let cursor = new Date(startWeek.mondayObj);
    const endCursor = new Date(endWeek.mondayObj);

    const today = new Date();
    today.setHours(0,0,0,0);

    while (cursor <= endCursor) {
        const monday = new Date(cursor);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);

        const weekStartStr = formatDate(monday);
        const weekEndStr = formatDate(sunday);

        const isFuture = monday > today; // week starts in the future

        weeks.push({
            week_start: weekStartStr,
            week_end: weekEndStr,
            weekStartObj: monday,
            weekEndObj: sunday,
            isFuture
        });

        // Move to next week
        cursor.setDate(cursor.getDate() + 7);
    }

    return weeks;
}

// Render the weeks universe with snippets, goals, reflections, and daily scores
function displayWeeks(weeks, snippetsMap, goalsMap, reflectionsMap, scoresMap) {
    const container = document.getElementById('snippetsContainer');

    if (!weeks || weeks.length === 0) {
        container.innerHTML = '<p>No weeks to display</p>';
        return;
    }

    let html = '';

    // Render weeks in reverse chronological order (latest week first)
    for (let i = weeks.length - 1; i >= 0; i--) {
        const week = weeks[i];
        const weekNum = getWeekNumber(week.week_start);
        const startFormatted = formatDateDisplay(week.week_start);
        const endFormatted = formatDateDisplay(week.week_end);

        html += `<div class="week-section">`;
        html += `  <div class="week-header">`;
        html += `    <span class="week-badge">Week ${weekNum}</span>`;
        html += `    <h2 class="week-title">${startFormatted} – ${endFormatted}</h2>`;
        if (dailyScoresEnabled) {
            html += renderScoreMeter(week, scoresMap);
        }
        html += `  </div>`;

        html += `  <div class="week-columns${goalsEnabled ? '' : ' single-column'}">`;

        // Left column: Snippets (What was done)
        html += `    <div class="week-column">`;
        if (goalsEnabled) {
            html += `      <h3 class="column-title">Work Done</h3>`;
        }
        html += `      <div class="snippet-content">`;

        const snippet = snippetsMap[week.week_start];
        if (snippet) {
            const enableMarkdown = true;
            const contentHtml = enableMarkdown ? marked.parse(snippet.content) : escapeHtml(snippet.content);
            html += contentHtml;
            html += `      </div>`;
            html += `      <div class="snippet-actions">`;
            html += `        <button class="edit-btn" onclick="openEditSnippetModal('${snippet.id}')">Edit</button>`;
            html += `        <button class="delete-btn" onclick="deleteSnippet('${snippet.id}')" title="Delete snippet">`;
            html += `          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">`;
            html += `            <polyline points="3 6 5 6 21 6"></polyline>`;
            html += `            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>`;
            html += `            <line x1="10" y1="11" x2="10" y2="17"></line>`;
            html += `            <line x1="14" y1="11" x2="14" y2="17"></line>`;
            html += `          </svg>`;
            html += `        </button>`;
            html += `      </div>`;
            // Show "Record Reflection" button for past weeks even when snippet exists (only if feature enabled)
            if (reflectionsEnabled) {
                const reflection = reflectionsMap[week.week_start];
                if (!week.isFuture && !reflection) {
                    html += `      <button class="record-reflection-btn" onclick="openNewReflectionModalForWeek('${week.week_start}','${week.week_end}')">Record Reflection</button>`;
                }
            }
        } else {
            html += `      </div>`;
            html += `      <div class="snippet-button-group">`;
            html += `        <button class="add-snippet-btn" onclick="openNewSnippetModalForWeek('${week.week_start}','${week.week_end}')">Add Snippets</button>`;
            if (githubAutofillEndeavor && currentEndeavor === githubAutofillEndeavor) {
                html += `        <button class="autofill-github-btn" id="autofill-${week.week_start}" onclick="autofillFromGithub('${week.week_start}','${week.week_end}')">Autofill from GitHub</button>`;
            }
            // Show "Record Reflection" button only for past weeks (only if feature enabled)
            if (reflectionsEnabled) {
                const reflection = reflectionsMap[week.week_start];
                if (!week.isFuture && !reflection) {
                    html += `        <button class="record-reflection-btn" onclick="openNewReflectionModalForWeek('${week.week_start}','${week.week_end}')">Record Reflection</button>`;
                }
            }
            html += `      </div>`;
        }

        html += `    </div>`;

        // Right column: Goals (What was planned) - only if feature is enabled
        if (goalsEnabled) {
            html += `    <div class="week-column">`;
            html += `      <h3 class="column-title">Weekly Goals</h3>`;
            html += `      <div class="snippet-content">`;

            const goal = goalsMap[week.week_start];
            if (goal) {
                const enableMarkdown = true;
                const contentHtml = enableMarkdown ? marked.parse(goal.content) : escapeHtml(goal.content);
                html += contentHtml;
                html += `      </div>`;
                html += `      <div class="snippet-actions">`;
                html += `        <button class="edit-btn" onclick="openEditGoalModal('${goal.id}')">Edit</button>`;
                html += `        <button class="delete-btn" onclick="deleteGoal('${goal.id}')" title="Delete goal">`;
                html += `          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">`;
                html += `            <polyline points="3 6 5 6 21 6"></polyline>`;
                html += `            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>`;
                html += `            <line x1="10" y1="11" x2="10" y2="17"></line>`;
                html += `            <line x1="14" y1="11" x2="14" y2="17"></line>`;
                html += `          </svg>`;
                html += `        </button>`;
                html += `      </div>`;
            } else {
                html += `      </div>`;
                html += `      <button class="add-snippet-btn" onclick="openNewGoalModalForWeek('${week.week_start}','${week.week_end}')">Add Goals</button>`;
            }
            html += `    </div>`;
        }

        html += `  </div>`;

        // Show reflection if it exists for past weeks (only if feature enabled)
        // Reflections span full width below the two columns
        if (reflectionsEnabled) {
            const reflection = reflectionsMap[week.week_start];
            if (reflection && !week.isFuture) {
                html += `  <div class="reflection-section">`;
                html += `    <h4 class="reflection-title">Reflection</h4>`;
                html += `    <div class="snippet-content">`;
                const enableMarkdown = true;
                const reflectionHtml = enableMarkdown ? marked.parse(reflection.content) : escapeHtml(reflection.content);
                html += reflectionHtml;
                html += `    </div>`;
                html += `    <div class="snippet-actions">`;
                html += `      <button class="edit-btn" onclick="openEditReflectionModal('${reflection.id}')">Edit</button>`;
                html += `      <button class="delete-btn" onclick="deleteReflection('${reflection.id}')" title="Delete reflection">`;
                html += `        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">`;
                html += `          <polyline points="3 6 5 6 21 6"></polyline>`;
                html += `          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>`;
                html += `          <line x1="10" y1="11" x2="10" y2="17"></line>`;
                html += `          <line x1="14" y1="11" x2="14" y2="17"></line>`;
                html += `        </svg>`;
                html += `      </button>`;
                html += `    </div>`;
                html += `  </div>`;
            }
        }

        html += `</div>`;
    }

    container.innerHTML = html;
}

// Render the daily movement score meter for a week
function renderScoreMeter(week, scoresMap) {
    let html = '<div class="score-meter">';
    html += '<span class="score-label">Daily Score</span>';

    // Get today's date for comparison (as ISO string YYYY-MM-DD)
    const today = new Date();
    const todayStr = formatDate(today);

    // Day names for tooltips
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Generate 7 squares for Mon-Sun
    const weekStartDate = new Date(week.weekStartObj);

    for (let i = 0; i < 7; i++) {
        const currentDate = new Date(weekStartDate);
        currentDate.setDate(currentDate.getDate() + i);
        const dateStr = formatDate(currentDate);
        const dayName = dayNames[currentDate.getDay()];

        // Check if this date has a score (1 = win/green, 0/undefined = default/no color)
        const hasScore = scoresMap[dateStr] === 1;

        // Determine if this date is in the past (can be toggled)
        // Past weeks: all 7 days will be < today, so all clickable
        // Current week: only days before today are clickable
        // Today and future: NOT clickable
        const isPast = dateStr < todayStr;
        const isClickable = isPast ? 'clickable' : '';
        const winClass = hasScore ? 'win' : '';

        // Build the square HTML
        if (isPast) {
            html += `<div class="score-square ${winClass} ${isClickable}" onclick="toggleDailyScore('${dateStr}', event)" title="${dayName}"></div>`;
        } else {
            html += `<div class="score-square ${winClass}" title="${dayName}"></div>`;
        }
    }

    html += '</div>';
    return html;
}

// Toggle a daily score (0 <-> 1)
async function toggleDailyScore(date, event) {
    // Immediate UI update - toggle the square
    const clickedSquare = event ? event.currentTarget : null;
    if (clickedSquare) {
        clickedSquare.classList.toggle('win');
    }

    try {
        // Save to server in background
        const response = await fetch('/api/daily_scores/toggle', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                date,
                endeavor: currentEndeavor
            })
        });

        if (!response.ok) {
            // Revert the UI update on failure
            if (clickedSquare) {
                clickedSquare.classList.toggle('win');
            }
            alert('Failed to update score');
        }
        // No reload needed - the UI is already updated!
    } catch (error) {
        console.error('Error toggling score:', error);
        // Revert the UI update on error
        if (clickedSquare) {
            clickedSquare.classList.toggle('win');
        }
        alert('Failed to update score');
    }
}

function displaySnippets(snippets) {
    const container = document.getElementById('snippetsContainer');
    
    if (snippets.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z"/>
                </svg>
                <h3>No snippets for this date range</h3>
                <p>Create your first snippet for this week!</p>
                <button class="add-snippet-btn" onclick="openNewSnippetModal()">Add Snippet</button>
            </div>
        `;
        return;
    }
    
    let html = '<button class="add-snippet-btn" onclick="openNewSnippetModal()">Add Snippet</button>';
    
    // Ensure snippets are shown in reverse chronological order (latest week first)
    snippets.sort((a, b) => new Date(b.week_start) - new Date(a.week_start));

    snippets.forEach(snippet => {
        const weekNum = getWeekNumber(snippet.week_start);
        const startFormatted = formatDateDisplay(snippet.week_start);
        const endFormatted = formatDateDisplay(snippet.week_end);
        
        const enableMarkdown = true; // You can store this preference
        const contentHtml = enableMarkdown ? marked.parse(snippet.content) : escapeHtml(snippet.content);
        
        html += `
            <div class="week-section">
                <div class="week-header">
                    <span class="week-badge">Current week</span>
                    <h2 class="week-title">Week ${weekNum}</h2>
                    <span class="week-date">· ${startFormatted}–${endFormatted.split(',')[0]}, ${endFormatted.split(',')[1]}</span>
                    <button style="margin-left: auto; padding: 4px 8px; border: none; background: none; color: #1a73e8; cursor: pointer;" onclick="copyWeekLink('${snippet.week_start}')">🔗</button>
                </div>
                <div class="snippet-content">
                    ${contentHtml}
                </div>
                <button class="edit-btn" onclick="openEditModal('${snippet.id}')">Edit</button>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function copyWeekLink(weekStart) {
    const url = `${window.location.origin}/?week=${weekStart}`;
    navigator.clipboard.writeText(url);
    alert('Link copied to clipboard!');
}

function openNewSnippetModal() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    
    if (!startDate || !endDate) {
        alert('Please select a date range first');
        return;
    }
    
    currentSnippetId = null;
    // Use the week containing the start date as the target week (snippets belong to a single week)
    const week = getWeekDates(new Date(startDate));
    currentWeekStart = week.monday;
    currentWeekEnd = week.sunday;
    
    const weekNum = getWeekNumber(startDate);
    const startFormatted = formatDateDisplay(currentWeekStart);
    const endFormatted = formatDateDisplay(currentWeekEnd);
    
    document.getElementById('modalTitle').textContent = `New Snippet - Week ${weekNum} (${startFormatted}–${endFormatted.split(',')[0]}, ${endFormatted.split(',')[1]})`;
    document.getElementById('snippetContent').value = '';
    
    showModal();
}

// Open the new snippet modal for a specific week (week boundaries passed)
function openNewSnippetModalForWeek(weekStart, weekEnd) {
    currentSnippetId = null;
    currentGoalId = null;
    currentModalType = 'snippet';
    currentWeekStart = weekStart;
    currentWeekEnd = weekEnd;

    const weekNum = getWeekNumber(weekStart);
    const startFormatted = formatDateDisplay(weekStart);
    const endFormatted = formatDateDisplay(weekEnd);

    document.getElementById('modalTitle').textContent = `New Work Done - Week ${weekNum} (${startFormatted}–${endFormatted.split(',')[0]}, ${endFormatted.split(',')[1]})`;
    document.getElementById('snippetContent').value = '';

    // Hide import link for snippets
    document.getElementById('importFromLastWeek').style.display = 'none';

    showModal();
}

// Open the new goal modal for a specific week (week boundaries passed)
function openNewGoalModalForWeek(weekStart, weekEnd) {
    currentSnippetId = null;
    currentGoalId = null;
    currentModalType = 'goal';
    currentWeekStart = weekStart;
    currentWeekEnd = weekEnd;

    const weekNum = getWeekNumber(weekStart);
    const startFormatted = formatDateDisplay(weekStart);
    const endFormatted = formatDateDisplay(weekEnd);

    document.getElementById('modalTitle').textContent = `New Weekly Goals - Week ${weekNum} (${startFormatted}–${endFormatted.split(',')[0]}, ${endFormatted.split(',')[1]})`;
    document.getElementById('snippetContent').value = '';

    // Show import link for new goals
    document.getElementById('importFromLastWeek').style.display = 'block';

    showModal();
}

async function openEditSnippetModal(snippetId) {
    try {
        const response = await fetch(`/api/snippets/${snippetId}`);
        const snippet = await response.json();

        currentSnippetId = snippetId;
        currentGoalId = null;
        currentModalType = 'snippet';
        currentWeekStart = snippet.week_start;
        currentWeekEnd = snippet.week_end;

        const weekNum = getWeekNumber(snippet.week_start);
        const startFormatted = formatDateDisplay(snippet.week_start);
        const endFormatted = formatDateDisplay(snippet.week_end);

        document.getElementById('modalTitle').textContent = `Edit Work Done - Week ${weekNum} (${startFormatted}–${endFormatted.split(',')[0]}, ${endFormatted.split(',')[1]})`;
        document.getElementById('snippetContent').value = snippet.content;

        showModal();
    } catch (error) {
        console.error('Error loading snippet:', error);
        alert('Failed to load snippet');
    }
}

async function openEditGoalModal(goalId) {
    try {
        const response = await fetch(`/api/goals/${goalId}`);
        const goal = await response.json();

        currentSnippetId = null;
        currentGoalId = goalId;
        currentModalType = 'goal';
        currentWeekStart = goal.week_start;
        currentWeekEnd = goal.week_end;

        const weekNum = getWeekNumber(goal.week_start);
        const startFormatted = formatDateDisplay(goal.week_start);
        const endFormatted = formatDateDisplay(goal.week_end);

        document.getElementById('modalTitle').textContent = `Edit Weekly Goals - Week ${weekNum} (${startFormatted}–${endFormatted.split(',')[0]}, ${endFormatted.split(',')[1]})`;
        document.getElementById('snippetContent').value = goal.content;

        // Hide import link when editing
        document.getElementById('importFromLastWeek').style.display = 'none';

        showModal();
    } catch (error) {
        console.error('Error loading goal:', error);
        alert('Failed to load goal');
    }
}

function showModal() {
    document.getElementById('editModal').classList.add('show');
}

function closeModal() {
    document.getElementById('editModal').classList.remove('show');
    document.getElementById('importFromLastWeek').style.display = 'none';
    currentSnippetId = null;
    currentGoalId = null;
    currentReflectionId = null;
    currentModalType = null;
}

async function saveSnippet() {
    const content = document.getElementById('snippetContent').value.trim();

    // Determine if we're working with snippet, goal, or reflection
    const isGoal = currentModalType === 'goal';
    const isReflection = currentModalType === 'reflection';
    const currentId = isGoal ? currentGoalId : (isReflection ? currentReflectionId : currentSnippetId);
    const apiPath = isGoal ? '/api/goals' : (isReflection ? '/api/reflections' : '/api/snippets');
    const itemType = isGoal ? 'goal' : (isReflection ? 'reflection' : 'snippet');

    // If content is empty and we're editing an existing item, delete it instead
    if (!content && currentId) {
        if (confirm(`Empty content will delete this ${itemType}. Continue?`)) {
            if (isGoal) {
                await deleteGoal(currentId, true);
            } else if (isReflection) {
                await deleteReflection(currentId, true);
            } else {
                await deleteSnippet(currentId, true);
            }
        }
        return;
    }

    if (!content) {
        alert('Please enter some content');
        return;
    }

    try {
        let response;

        if (currentId) {
            // Update existing item
            response = await fetch(`${apiPath}/${currentId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    content,
                    endeavor: currentEndeavor
                })
            });
        } else {
            // Create new item
            response = await fetch(apiPath, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    week_start: currentWeekStart,
                    week_end: currentWeekEnd,
                    content,
                    endeavor: currentEndeavor
                })
            });
        }

        if (response.ok) {
            closeModal();
            await loadSnippets();
        } else {
            alert(`Failed to save ${itemType}`);
        }
    } catch (error) {
        console.error(`Error saving ${itemType}:`, error);
        alert(`Failed to save ${itemType}`);
    }
}

async function deleteSnippet(snippetId, skipConfirm = false) {
    if (!skipConfirm && !confirm('Are you sure you want to delete this snippet?')) {
        return;
    }

    try {
        const response = await fetch(`/api/snippets/${snippetId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            closeModal();
            await loadSnippets();
        } else {
            alert('Failed to delete snippet');
        }
    } catch (error) {
        console.error('Error deleting snippet:', error);
        alert('Failed to delete snippet');
    }
}

async function deleteGoal(goalId, skipConfirm = false) {
    if (!skipConfirm && !confirm('Are you sure you want to delete this goal?')) {
        return;
    }

    try {
        const response = await fetch(`/api/goals/${goalId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            closeModal();
            await loadSnippets();
        } else {
            alert('Failed to delete goal');
        }
    } catch (error) {
        console.error('Error deleting goal:', error);
        alert('Failed to delete goal');
    }
}

// Open the new reflection modal for a specific week (week boundaries passed)
function openNewReflectionModalForWeek(weekStart, weekEnd) {
    currentSnippetId = null;
    currentGoalId = null;
    currentReflectionId = null;
    currentModalType = 'reflection';
    currentWeekStart = weekStart;
    currentWeekEnd = weekEnd;

    const weekNum = getWeekNumber(weekStart);
    const startFormatted = formatDateDisplay(weekStart);
    const endFormatted = formatDateDisplay(weekEnd);

    document.getElementById('modalTitle').textContent = `Record Reflection - Week ${weekNum} (${startFormatted}–${endFormatted.split(',')[0]}, ${endFormatted.split(',')[1]})`;

    const defaultReflectionTemplate = `- **What worked well?**
  - <Insert>
- **What was not a great use of time?**
  - <Insert>
- **What do I wish to have spent more time on?**
  - <Insert>
`;

    document.getElementById('snippetContent').value = defaultReflectionTemplate;

    // Hide import link for reflections
    document.getElementById('importFromLastWeek').style.display = 'none';

    showModal();
}

async function openEditReflectionModal(reflectionId) {
    try {
        const response = await fetch(`/api/reflections/${reflectionId}`);
        const reflection = await response.json();

        currentSnippetId = null;
        currentGoalId = null;
        currentReflectionId = reflectionId;
        currentModalType = 'reflection';
        currentWeekStart = reflection.week_start;
        currentWeekEnd = reflection.week_end;

        const weekNum = getWeekNumber(reflection.week_start);
        const startFormatted = formatDateDisplay(reflection.week_start);
        const endFormatted = formatDateDisplay(reflection.week_end);

        document.getElementById('modalTitle').textContent = `Edit Reflection - Week ${weekNum} (${startFormatted}–${endFormatted.split(',')[0]}, ${endFormatted.split(',')[1]})`;
        document.getElementById('snippetContent').value = reflection.content;

        showModal();
    } catch (error) {
        console.error('Error loading reflection:', error);
        alert('Failed to load reflection');
    }
}

async function deleteReflection(reflectionId, skipConfirm = false) {
    if (!skipConfirm && !confirm('Are you sure you want to delete this reflection?')) {
        return;
    }

    try {
        const response = await fetch(`/api/reflections/${reflectionId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            closeModal();
            await loadSnippets();
        } else {
            alert('Failed to delete reflection');
        }
    } catch (error) {
        console.error('Error deleting reflection:', error);
        alert('Failed to delete reflection');
    }
}

async function autofillFromGithub(weekStart, weekEnd) {
    const btn = document.getElementById(`autofill-${weekStart}`);
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Fetching commits...';
    }

    try {
        const response = await fetch('/api/github/autofill-week', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ week_start: weekStart, week_end: weekEnd, endeavor: currentEndeavor }),
        });

        const data = await response.json();

        if (!response.ok) {
            alert(data.error || 'Failed to autofill from GitHub');
            return;
        }

        // Open the snippet modal pre-populated with the generated summary
        openNewSnippetModalForWeek(weekStart, weekEnd);
        document.getElementById('snippetContent').value = data.content;
    } catch (error) {
        console.error('Error autofilling from GitHub:', error);
        alert('Failed to autofill from GitHub');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Autofill from GitHub';
        }
    }
}

async function importFromLastWeek() {
    if (!currentWeekStart) {
        alert('Cannot determine current week');
        return;
    }

    try {
        // Calculate last week's start date (7 days before current week)
        const currentWeekParts = currentWeekStart.split('-').map(Number);
        const currentWeekDate = new Date(currentWeekParts[0], currentWeekParts[1] - 1, currentWeekParts[2]);
        currentWeekDate.setDate(currentWeekDate.getDate() - 7);

        const lastWeekStart = formatDate(currentWeekDate);
        const lastWeekEnd = getWeekDates(currentWeekDate).sunday;

        // Fetch goals for last week
        const endeavorParam = currentEndeavor ? `&endeavor=${encodeURIComponent(currentEndeavor)}` : '';
        const response = await fetch(`/api/goals?start_date=${lastWeekStart}&end_date=${lastWeekEnd}${endeavorParam}`);
        if (!response.ok) {
            throw new Error('Failed to fetch last week goals');
        }

        const goals = await response.json();
        const lastWeekGoal = goals.find(g => g.week_start === lastWeekStart);

        if (lastWeekGoal && lastWeekGoal.content) {
            document.getElementById('snippetContent').value = lastWeekGoal.content;
            // Hide the import link after successful import
            document.getElementById('importFromLastWeek').style.display = 'none';
        } else {
            alert('No goals found for last week');
        }
    } catch (error) {
        console.error('Error importing from last week:', error);
        alert('Failed to import goals from last week');
    }
}

function insertMarkdown(before, after = '') {
    const textarea = document.getElementById('snippetContent');
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selectedText = text.substring(start, end);

    const newText = text.substring(0, start) + before + selectedText + after + text.substring(end);
    textarea.value = newText;

    // Set cursor position
    const newPos = start + before.length + selectedText.length + after.length;
    textarea.focus();
    textarea.setSelectionRange(newPos, newPos);
}

function logout() {
    if (confirm('Are you sure you want to logout?')) {
        window.location.href = '/logout';
    }
}


// Handle keyboard shortcuts
document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('editModal');

    if (modal.classList.contains('show')) {
        if (e.key === 'Escape') {
            closeModal();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            saveSnippet();
        }
    }
});

// Function to handle home navigation
function goToHome() {
    // Go to default view with 4-week range
    initializeDefaultView();
}

// Endeavor management functions

// Load all endeavors from the API
async function loadEndeavors() {
    try {
        const response = await fetch('/api/endeavors');
        if (!response.ok) {
            throw new Error('Failed to load endeavors');
        }
        const endeavors = await response.json();
        endeavorsCache = endeavors.length > 0 ? endeavors : ['pet project'];

        // If current endeavor doesn't exist in the list, use the first one
        if (!endeavorsCache.includes(currentEndeavor)) {
            currentEndeavor = endeavorsCache[0];
            updateURL();
        }

        renderTabs(endeavorsCache);
    } catch (error) {
        console.error('Error loading endeavors:', error);
        // Fallback to default
        endeavorsCache = ['pet project'];
        renderTabs(endeavorsCache);
    }
}

// Render the endeavor tabs
function renderTabs(endeavors) {
    const container = document.getElementById('tabsContainer');
    if (!container) return;

    let html = '';
    endeavors.forEach(endeavor => {
        const isActive = endeavor === currentEndeavor ? 'active' : '';
        html += `<button class="endeavor-tab ${isActive}" onclick="switchEndeavor('${escapeHtml(endeavor)}')" ondblclick="startRenameEndeavor('${escapeHtml(endeavor)}')" title="${escapeHtml(endeavor)}">${escapeHtml(endeavor)}</button>`;
    });
    container.innerHTML = html;
}

// Switch to a different endeavor
function switchEndeavor(endeavor) {
    if (endeavor === currentEndeavor) return;

    currentEndeavor = endeavor;

    // Update URL with new endeavor
    updateURL();

    // Re-render tabs to show active state
    renderTabs(endeavorsCache);

    // Reload all data for the new endeavor
    loadSnippets();
}

// Update URL with current endeavor and date range
function updateURL() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    const params = new URLSearchParams();
    if (currentEndeavor && currentEndeavor !== 'pet project') {
        params.set('endeavor', currentEndeavor);
    }
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);

    const newURL = `${window.location.pathname}?${params.toString()}`;
    window.history.pushState({}, '', newURL);
}

// Start renaming an endeavor (double-click)
function startRenameEndeavor(endeavor) {
    const container = document.getElementById('tabsContainer');
    const tabs = container.querySelectorAll('.endeavor-tab');

    // Find the tab for this endeavor
    for (let tab of tabs) {
        if (tab.textContent === endeavor) {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = endeavor;
            input.className = 'endeavor-tab editable';

            // Replace button with input
            tab.replaceWith(input);
            input.focus();
            input.select();

            // Handle save on Enter
            input.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const newName = input.value.trim();
                    if (newName && newName !== endeavor) {
                        await renameEndeavor(endeavor, newName);
                    } else {
                        renderTabs(endeavorsCache);
                    }
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    renderTabs(endeavorsCache);
                }
            });

            // Handle blur (click outside)
            input.addEventListener('blur', () => {
                setTimeout(() => renderTabs(endeavorsCache), 200);
            });

            break;
        }
    }
}

// Rename an endeavor
async function renameEndeavor(oldName, newName) {
    if (!newName || newName === oldName) {
        renderTabs(endeavorsCache);
        return;
    }

    try {
        const response = await fetch('/api/endeavors/rename', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                old_name: oldName,
                new_name: newName
            })
        });

        if (!response.ok) {
            throw new Error('Failed to rename endeavor');
        }

        // Update cache
        const index = endeavorsCache.indexOf(oldName);
        if (index !== -1) {
            endeavorsCache[index] = newName;
        }

        // If we renamed the current endeavor, update it
        if (currentEndeavor === oldName) {
            currentEndeavor = newName;
            updateURL();
        }

        // Re-render tabs
        renderTabs(endeavorsCache);

        // Reload data
        await loadSnippets();
    } catch (error) {
        console.error('Error renaming endeavor:', error);
        alert('Failed to rename endeavor');
        renderTabs(endeavorsCache);
    }
}

// Create a new endeavor
async function createNewEndeavor() {
    const name = prompt('Enter the name for the new endeavor:');
    if (!name || !name.trim()) {
        return;
    }

    const trimmedName = name.trim();

    // Check if it already exists
    if (endeavorsCache.includes(trimmedName)) {
        alert('An endeavor with this name already exists');
        return;
    }

    // Add to cache
    endeavorsCache.push(trimmedName);

    // Switch to the new endeavor
    switchEndeavor(trimmedName);
}

// View switching functions

function switchToView(view) {
    currentView = view;

    // Update button states
    document.getElementById('endeavorsViewBtn').classList.toggle('active', view === 'endeavors');
    document.getElementById('fitnessViewBtn').classList.toggle('active', view === 'fitness');

    if (view === 'endeavors') {
        // Show endeavors view
        document.getElementById('endeavorTabsSection').style.display = 'flex';
        document.getElementById('snippetsContainer').style.display = 'block';
        document.getElementById('fitnessContainer').style.display = 'none';
        document.querySelector('.date-controls').style.display = 'flex';
    } else {
        // Show fitness view
        document.getElementById('endeavorTabsSection').style.display = 'none';
        document.getElementById('snippetsContainer').style.display = 'none';
        document.getElementById('fitnessContainer').style.display = 'block';
        document.querySelector('.date-controls').style.display = 'flex';
        loadFitnessView();
    }
}

// Fitness functions

async function loadFitnessView() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    if (!startDate || !endDate) return;

    try {
        // Load habits and tracking data
        const [habitsResponse, trackingResponse] = await Promise.all([
            fetch('/api/fitness/habits'),
            fetch(`/api/fitness/tracking?start_date=${startDate}&end_date=${endDate}`)
        ]);

        fitnessHabits = await habitsResponse.json();
        const trackingData = await trackingResponse.json();

        // Build tracking map: { date: { habit_id: true } }
        fitnessTracking = {};
        trackingData.forEach(record => {
            if (!fitnessTracking[record.date]) {
                fitnessTracking[record.date] = {};
            }
            fitnessTracking[record.date][record.habit_id] = true;
        });

        renderFitnessView(startDate, endDate);
    } catch (error) {
        console.error('Error loading fitness data:', error);
    }
}

function renderFitnessView(startDate, endDate) {
    const container = document.getElementById('fitnessContainer');

    // Compute weeks in range
    const weeks = computeUniverseWeeks(startDate, endDate);

    let html = '<div class="fitness-header">';
    html += '<h1>Fitness Tracking</h1>';
    html += '<button class="add-habit-btn" onclick="openAddHabitModal()">+ Add Habit</button>';
    html += '</div>';

    if (fitnessHabits.length === 0) {
        html += '<p style="text-align: center; color: #5f6368; padding: 40px;">No habits configured. Click "+ Add Habit" to get started.</p>';
        container.innerHTML = html;
        return;
    }

    // Render table for each week
    weeks.reverse().forEach(week => {
        html += renderWeekFitnessTable(week);
    });

    container.innerHTML = html;
}

function renderWeekFitnessTable(week) {
    const weekNum = getWeekNumber(week.week_start);
    const startFormatted = formatDateDisplay(week.week_start);
    const endFormatted = formatDateDisplay(week.week_end);

    let html = '<div class="week-section" style="margin-bottom: 40px;">';
    html += `<div class="week-header">`;
    html += `<span class="week-badge">Week ${weekNum}</span>`;
    html += `<h2 class="week-title">${startFormatted} – ${endFormatted}</h2>`;
    html += `</div>`;

    html += '<div class="fitness-grid">';
    html += '<table class="fitness-table">';
    html += '<thead><tr>';
    html += '<th>Habit</th>';

    // Day headers (Mon-Sun)
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    dayNames.forEach(day => {
        html += `<th style="text-align: center;">${day}</th>`;
    });

    html += '<th style="text-align: center;">Progress</th>';
    html += '</tr></thead>';
    html += '<tbody>';

    // Render each habit
    fitnessHabits.forEach(habit => {
        html += '<tr>';
        html += `<td>`;
        html += `<div class="habit-name">${escapeHtml(habit.name)}</div>`;
        html += `<div class="habit-frequency">${habit.frequency_per_week}x/week</div>`;
        html += `</td>`;

        // Render checkboxes for each day
        const weekStartDate = new Date(week.weekStartObj);
        let completedCount = 0;

        for (let i = 0; i < 7; i++) {
            const currentDate = new Date(weekStartDate);
            currentDate.setDate(currentDate.getDate() + i);
            const dateStr = formatDate(currentDate);

            const isCompleted = fitnessTracking[dateStr]?.[habit.id] || false;
            if (isCompleted) completedCount++;

            const today = new Date();
            const todayStr = formatDate(today);
            const isPast = dateStr <= todayStr;

            html += '<td style="text-align: center;">';
            const clickableClass = isPast ? 'clickable' : '';
            const winClass = isCompleted ? 'win' : '';
            if (isPast) {
                html += `<div class="score-square ${winClass} ${clickableClass}" onclick="toggleHabitTracking('${dateStr}', '${habit.id}', event)"></div>`;
            } else {
                html += `<div class="score-square"></div>`;
            }
            html += '</td>';
        }

        // Progress column
        const progressClass = completedCount >= habit.frequency_per_week ? 'complete' : 'incomplete';
        html += `<td style="text-align: center;"><span class="habit-progress ${progressClass}">${completedCount}/${habit.frequency_per_week}</span></td>`;

        html += '</tr>';
    });

    html += '</tbody></table>';
    html += '</div>'; // fitness-grid
    html += '</div>'; // week-section

    return html;
}

async function toggleHabitTracking(date, habitId, event) {
    // Immediate UI update - toggle the square
    const clickedSquare = event ? event.currentTarget : null;
    if (clickedSquare) {
        clickedSquare.classList.toggle('win');
    }

    try {
        const response = await fetch('/api/fitness/tracking/toggle', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                date,
                habit_id: habitId
            })
        });

        if (response.ok) {
            const result = await response.json();

            // Update local cache
            if (!fitnessTracking[date]) {
                fitnessTracking[date] = {};
            }

            if (result.completed) {
                fitnessTracking[date][habitId] = true;
            } else {
                delete fitnessTracking[date][habitId];
            }

            // Reload view to update progress
            const startDate = document.getElementById('startDate').value;
            const endDate = document.getElementById('endDate').value;
            renderFitnessView(startDate, endDate);
        } else {
            // Revert the UI update on failure
            if (clickedSquare) {
                clickedSquare.classList.toggle('win');
            }
            alert('Failed to update tracking');
        }
    } catch (error) {
        console.error('Error toggling habit tracking:', error);
        // Revert the UI update on error
        if (clickedSquare) {
            clickedSquare.classList.toggle('win');
        }
        alert('Failed to update tracking');
    }
}

async function openAddHabitModal() {
    const name = prompt('Enter habit name (e.g., "Protein intake in the morning"):');
    if (!name || !name.trim()) return;

    const frequency = prompt('How many times per week? (1-7):');
    const frequencyNum = parseInt(frequency);
    if (!frequencyNum || frequencyNum < 1 || frequencyNum > 7) {
        alert('Please enter a valid frequency between 1 and 7');
        return;
    }

    try {
        const response = await fetch('/api/fitness/habits', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: name.trim(),
                frequency_per_week: frequencyNum,
                category: 'general',
                order: fitnessHabits.length
            })
        });

        if (response.ok) {
            loadFitnessView();
        } else {
            alert('Failed to create habit');
        }
    } catch (error) {
        console.error('Error creating habit:', error);
        alert('Failed to create habit');
    }
}
