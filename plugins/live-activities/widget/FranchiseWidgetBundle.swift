import SwiftUI
import WidgetKit

@main
struct FranchiseWidgetBundle: WidgetBundle {
    var body: some Widget {
        MatchupActivityWidget()
        // AuctionDraftActivityWidget() — uncomment when auction draft ships
    }
}
