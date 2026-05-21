// Barrel for the trade hooks. The implementation is split by data source under
// hooks/trades/ (proposals/votes, tradable picks, trade block); this file
// preserves the original import path so consumers can keep importing from
// '@/hooks/useTrades'.

export type { TradeItemRow, TradeProposalRow } from './trades/types';

export {
  useTradeProposals,
  useTradeProposalsHeadshots,
  useTradeVotes,
  useMyPendingTrades,
} from './trades/proposals';

export { useTeamTradablePicks } from './trades/tradablePicks';

export {
  useTradeBlock,
  useToggleTradeBlockInterest,
  type TradeBlockPlayer,
  type TradeBlockTeamGroup,
} from './trades/tradeBlock';
