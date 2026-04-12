import ActivityKit
import Foundation

// MARK: - Matchup Activity

struct MatchupAttributes: ActivityAttributes {
    /// Static context set when the activity starts
    var myTeamName: String
    var opponentTeamName: String
    var myTeamTricode: String
    var opponentTeamTricode: String
    var matchupId: String
    var leagueId: String

    /// Dynamic state updated via APNs push (~30s during games)
    struct ContentState: Codable, Hashable {
        var myScore: Double
        var opponentScore: Double
        var scoreGap: Double
        var winProbability: Double?  // nil unless gap < threshold on final day
        var biggestContributor: String  // e.g. "LeBron 28pts"
        var myActivePlayers: Int
        var opponentActivePlayers: Int
        var players: [PlayerLine]  // top 5 by FPTS
    }
}

struct PlayerLine: Codable, Hashable {
    var name: String
    var statLine: String      // "23p 8r 5a"
    var fantasyPoints: Double
    var gameStatus: String    // "3rd 5:23" or "Final"
    var isOnCourt: Bool
}

// MARK: - Auction Draft Activity (Future)

struct AuctionDraftAttributes: ActivityAttributes {
    var draftId: String
    var leagueName: String

    struct ContentState: Codable, Hashable {
        var currentPlayerName: String
        var currentPlayerPosition: String
        var highBid: Int
        var highBidTeam: String
        var myBudgetRemaining: Int
        var timeRemaining: Int  // seconds
        var nominatedBy: String
    }
}
