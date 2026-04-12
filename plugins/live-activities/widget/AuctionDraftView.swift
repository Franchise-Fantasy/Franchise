import ActivityKit
import SwiftUI
import WidgetKit

// Placeholder for future auction draft Live Activity.
// Uncomment in FranchiseWidgetBundle when auction draft system ships.

struct AuctionDraftActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AuctionDraftAttributes.self) { context in
            // Lock Screen
            VStack(spacing: 8) {
                Text(context.state.currentPlayerName)
                    .font(.headline)
                    .foregroundColor(.white)
                HStack {
                    Text("High bid: $\(context.state.highBid)")
                        .font(.subheadline)
                        .foregroundColor(.green)
                    Spacer()
                    Text(context.state.highBidTeam)
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.7))
                }
                Text("Budget: $\(context.state.myBudgetRemaining)")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.5))
            }
            .padding(16)
            .activityBackgroundTint(.black.opacity(0.85))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading) {
                        Text(context.state.currentPlayerName)
                            .font(.caption)
                            .fontWeight(.bold)
                        Text(context.state.currentPlayerPosition)
                            .font(.caption2)
                            .foregroundColor(.white.opacity(0.6))
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing) {
                        Text("$\(context.state.highBid)")
                            .font(.title3)
                            .fontWeight(.bold)
                            .foregroundColor(.green)
                        Text(context.state.highBidTeam)
                            .font(.caption2)
                            .foregroundColor(.white.opacity(0.6))
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text("My budget: $\(context.state.myBudgetRemaining)")
                            .font(.caption2)
                        Spacer()
                        Text("\(context.state.timeRemaining)s")
                            .font(.caption2)
                            .foregroundColor(.orange)
                    }
                }
            } compactLeading: {
                Text(context.state.currentPlayerName)
                    .font(.caption2)
                    .lineLimit(1)
            } compactTrailing: {
                Text("$\(context.state.highBid)")
                    .font(.caption2)
                    .fontWeight(.bold)
                    .foregroundColor(.green)
            } minimal: {
                Text("$\(context.state.highBid)")
                    .font(.caption2)
                    .foregroundColor(.green)
            }
        }
    }
}
