/**
 * Deno-side re-export of the pure Live Activity content-state helpers.
 * Real logic lives in utils/liveActivity/contentState.ts so client and edge stay aligned.
 */

export {
  buildCategoriesContentState,
  buildPointsContentState,
  categoryResultsToLines,
  formatTopCategory,
  rankCategories,
  type CategoriesContentState,
  type LiveActivityContentState,
  type LiveCategoryLine,
  type LiveMarginTrend,
  type LiveMoment,
  type LiveNextTipoff,
  type LivePlayerLine,
  type PointsContentState,
} from '../../../utils/liveActivity/contentState.ts';
