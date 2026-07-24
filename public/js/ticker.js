/**
 * Polls /api/matches/:id/ticker every 15s for any fixture currently marked
 * live on the page, and refreshes the scoreboard feed without a reload.
 */
(function () {
  const feeds = document.querySelectorAll('[data-fixture-id]');
  if (!feeds.length) return;

  const EVENT_LABELS = {
    goal: 'Goal',
    assist: 'Assist',
    yellow_card: 'Yellow Card',
    red_card: 'Red Card',
    substitution_in: 'Sub In',
    substitution_out: 'Sub Out',
  };

  async function refreshFeed(el) {
    const fixtureId = el.getAttribute('data-fixture-id');
    try {
      const res = await fetch(`/api/matches/${fixtureId}/ticker`);
      const data = await res.json();
      if (!data.ok || !data.events?.length) return;

      el.innerHTML = data.events
        .map((e) => {
          const label = EVENT_LABELS[e.event_type] || e.event_type;
          const minute = e.minute != null ? `${e.minute}'` : '';
          const player = e.player_name || '';
          return `<span class="scoreboard__feed-item">${minute} <b>${label}</b> ${player}</span>`;
        })
        .join('');
    } catch (err) {
      // Silent fail — the static scoreboard remains visible.
    }
  }

  feeds.forEach(refreshFeed);
  setInterval(() => feeds.forEach(refreshFeed), 15000);
})();
