import ActivityKit
import SwiftUI
import WidgetKit

struct MatchupActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MatchupAttributes.self) { context in
            // Lock Screen / banner presentation
            LockScreenView(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(.black.opacity(0.85))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded regions (long press)
                DynamicIslandExpandedRegion(.leading) {
                    TeamScoreColumn(
                        tricode: context.attributes.myTeamTricode,
                        score: context.state.myScore,
                        isLeading: true
                    )
                }
                DynamicIslandExpandedRegion(.trailing) {
                    TeamScoreColumn(
                        tricode: context.attributes.opponentTeamTricode,
                        score: context.state.opponentScore,
                        isLeading: false
                    )
                }
                DynamicIslandExpandedRegion(.center) {
                    ExpandedCenterView(state: context.state)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    PlayerStatsView(players: context.state.players)
                }
            } compactLeading: {
                // Left of camera: my team + score
                HStack(spacing: 4) {
                    Text(context.attributes.myTeamTricode)
                        .font(.caption2)
                        .fontWeight(.bold)
                        .foregroundColor(.white.opacity(0.7))
                    Text(String(format: "%.1f", context.state.myScore))
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundColor(.white)
                        .contentTransition(.numericText())
                }
            } compactTrailing: {
                // Right of camera: opponent + score
                HStack(spacing: 4) {
                    Text(String(format: "%.1f", context.state.opponentScore))
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundColor(.white)
                        .contentTransition(.numericText())
                    Text(context.attributes.opponentTeamTricode)
                        .font(.caption2)
                        .fontWeight(.bold)
                        .foregroundColor(.white.opacity(0.7))
                }
            } minimal: {
                // Minimal (when multiple activities compete for space)
                Text(String(format: "%.0f", context.state.scoreGap))
                    .font(.caption2)
                    .fontWeight(.bold)
                    .foregroundColor(context.state.scoreGap >= 0 ? .green : .red)
            }
        }
    }
}

// MARK: - Subviews

private struct TeamScoreColumn: View {
    let tricode: String
    let score: Double
    let isLeading: Bool

    var body: some View {
        VStack(spacing: 2) {
            Text(tricode)
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundColor(.white.opacity(0.7))
            Text(String(format: "%.1f", score))
                .font(.title2)
                .fontWeight(.bold)
                .foregroundColor(.white)
                .contentTransition(.numericText())
        }
        .frame(maxWidth: .infinity, alignment: isLeading ? .leading : .trailing)
    }
}

private struct ExpandedCenterView: View {
    let state: MatchupAttributes.ContentState

    var body: some View {
        VStack(spacing: 4) {
            // Score gap
            let gap = state.scoreGap
            let sign = gap >= 0 ? "+" : ""
            Text("\(sign)\(String(format: "%.1f", gap))")
                .font(.caption)
                .fontWeight(.bold)
                .foregroundColor(gap >= 0 ? .green : .red)
                .contentTransition(.numericText())

            // Win probability (only shown when close)
            if let prob = state.winProbability {
                Text("\(Int(prob * 100))% win")
                    .font(.caption2)
                    .foregroundColor(.white.opacity(0.6))
            }

            // Biggest contributor
            if !state.biggestContributor.isEmpty {
                Text(state.biggestContributor)
                    .font(.caption2)
                    .foregroundColor(.yellow)
                    .lineLimit(1)
            }

            // Active players
            Text("\(state.myActivePlayers) vs \(state.opponentActivePlayers) playing")
                .font(.caption2)
                .foregroundColor(.white.opacity(0.5))
        }
    }
}

private struct PlayerStatsView: View {
    let players: [PlayerLine]

    var body: some View {
        if players.isEmpty {
            Text("No active players")
                .font(.caption2)
                .foregroundColor(.white.opacity(0.4))
        } else {
            VStack(spacing: 3) {
                ForEach(players.prefix(5), id: \.name) { player in
                    HStack {
                        // On-court indicator
                        Circle()
                            .fill(player.isOnCourt ? .green : .gray)
                            .frame(width: 5, height: 5)

                        Text(player.name)
                            .font(.caption2)
                            .fontWeight(.medium)
                            .foregroundColor(.white)
                            .lineLimit(1)

                        Spacer()

                        Text(player.statLine)
                            .font(.caption2)
                            .foregroundColor(.white.opacity(0.7))

                        Text(String(format: "%.1f", player.fantasyPoints))
                            .font(.caption2)
                            .fontWeight(.bold)
                            .foregroundColor(.white)
                            .frame(width: 35, alignment: .trailing)

                        Text(player.gameStatus)
                            .font(.system(size: 9))
                            .foregroundColor(.white.opacity(0.5))
                            .frame(width: 40, alignment: .trailing)
                    }
                }
            }
        }
    }
}

// MARK: - Lock Screen View

private struct LockScreenView: View {
    let attributes: MatchupAttributes
    let state: MatchupAttributes.ContentState

    var body: some View {
        VStack(spacing: 8) {
            // Scoreboard header
            HStack {
                VStack(alignment: .leading) {
                    Text(attributes.myTeamTricode)
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.7))
                    Text(String(format: "%.1f", state.myScore))
                        .font(.title2)
                        .fontWeight(.bold)
                        .foregroundColor(.white)
                        .contentTransition(.numericText())
                }

                Spacer()

                VStack {
                    let gap = state.scoreGap
                    let sign = gap >= 0 ? "+" : ""
                    Text("\(sign)\(String(format: "%.1f", gap))")
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundColor(gap >= 0 ? .green : .red)

                    if let prob = state.winProbability {
                        Text("\(Int(prob * 100))%")
                            .font(.caption2)
                            .foregroundColor(.white.opacity(0.6))
                    }
                }

                Spacer()

                VStack(alignment: .trailing) {
                    Text(attributes.opponentTeamTricode)
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.7))
                    Text(String(format: "%.1f", state.opponentScore))
                        .font(.title2)
                        .fontWeight(.bold)
                        .foregroundColor(.white)
                        .contentTransition(.numericText())
                }
            }

            // Biggest contributor
            if !state.biggestContributor.isEmpty {
                Text(state.biggestContributor)
                    .font(.caption)
                    .foregroundColor(.yellow)
            }

            // Player stat lines
            if !state.players.isEmpty {
                Divider().background(.white.opacity(0.2))
                PlayerStatsView(players: state.players)
            }

            // Footer
            Text("\(state.myActivePlayers + state.opponentActivePlayers) games live")
                .font(.caption2)
                .foregroundColor(.white.opacity(0.4))
        }
        .padding(16)
    }
}
