/**
 * Service de calcul de l'index FootGolf SSFG
 *
 * Formule :
 * - Score attendu = Par du parcours + Index actuel
 * - Mieux que l'index → -0.1 par point gagné
 * - Moins bien → +0.3 par point perdu
 * - Nouveau joueur → index = 1.0
 * - Inactivité : +0.3 tous les 3 mois sans carte
 */

/**
 * Calcule la variation d'index pour une carte
 * @param {number} totalScore - Score brut total (18 trous)
 * @param {number} parTotal - Par du parcours
 * @param {number} currentIndex - Index avant la partie
 * @returns {{ change: number, newIndex: number, expectedScore: number, pointsDiff: number }}
 */
function calculateIndexChange(totalScore, parTotal, currentIndex) {
  const expectedScore = parTotal + Number(currentIndex);
  const pointsDiff = totalScore - expectedScore; // négatif = mieux, positif = moins bien

  let change = 0;
  if (pointsDiff < 0) {
    // Mieux que l'index → -0.1 par point gagné
    change = pointsDiff * 0.1; // pointsDiff est négatif, donc change négatif
  } else if (pointsDiff > 0) {
    // Moins bien → +0.3 par point perdu
    change = pointsDiff * 0.3;
  }

  // Arrondi à 1 décimale
  change = Math.round(change * 10) / 10;
  const newIndex = Math.round((Number(currentIndex) + change) * 10) / 10;

  return {
    change,
    newIndex,
    expectedScore,
    pointsDiff,
  };
}

/**
 * Calcule la dégradation pour inactivité
 * @param {Date|string|null} lastRoundDate
 * @param {number} currentIndex
 * @returns {{ change: number, newIndex: number, periods: number } | null}
 */
function calculateInactivityPenalty(lastRoundDate, currentIndex) {
  if (!lastRoundDate) return null;

  const last = new Date(lastRoundDate);
  const now = new Date();
  const monthsDiff =
    (now.getFullYear() - last.getFullYear()) * 12 +
    (now.getMonth() - last.getMonth());

  // À partir de 3 mois, puis tous les 3 mois
  if (monthsDiff < 3) return null;

  const periods = Math.floor(monthsDiff / 3);
  const change = periods * 0.3;
  const newIndex = Math.round((Number(currentIndex) + change) * 10) / 10;

  return { change, newIndex, periods };
}

/**
 * Détermine la série d'index
 * @param {number} index
 * @returns {'master'|'serie1'|'serie2'}
 */
function getIndexSeries(index) {
  const val = Number(index);
  if (val < 0) return 'master';
  if (val <= 5) return 'serie1';
  return 'serie2';
}

/**
 * Détermine les catégories d'âge/genre
 * @param {Object} user - { gender, birth_date, is_rookie }
 * @returns {string[]}
 */
function getCategories(user) {
  const cats = [];
  const today = new Date();

  if (user.gender === 'F') cats.push('feminines');
  if (user.gender === 'M') cats.push('mens');

  if (user.birth_date) {
    const birth = new Date(user.birth_date);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;

    if (age < 18) cats.push('juniors');
    if (age >= 45) cats.push('seniors');
    if (age >= 55) cats.push('veterans');
  }

  if (user.is_rookie) cats.push('rookies');

  return cats;
}

module.exports = {
  calculateIndexChange,
  calculateInactivityPenalty,
  getIndexSeries,
  getCategories,
};
