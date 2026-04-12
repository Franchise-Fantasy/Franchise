import ActivityKit
import Foundation
import React

/// Native module bridge exposing ActivityKit to React Native JS.
/// Methods: startMatchupActivity, endActivity, endAllActivities, getActiveActivities
@objc(FranchiseLiveActivityModule)
class FranchiseLiveActivityModule: NSObject {

    // Track push token observation tasks so we can cancel them
    private var tokenTasks: [String: Task<Void, Never>] = [:]

    @objc static func requiresMainQueueSetup() -> Bool { false }

    // MARK: - Start Matchup Activity

    @objc func startMatchupActivity(
        _ attributes: NSDictionary,
        initialState: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.1, *) else {
            reject("UNSUPPORTED", "Live Activities require iOS 16.1+", nil)
            return
        }

        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            reject("DISABLED", "Live Activities are disabled in Settings", nil)
            return
        }

        do {
            let attrs = MatchupAttributes(
                myTeamName: attributes["myTeamName"] as? String ?? "",
                opponentTeamName: attributes["opponentTeamName"] as? String ?? "",
                myTeamTricode: attributes["myTeamTricode"] as? String ?? "",
                opponentTeamTricode: attributes["opponentTeamTricode"] as? String ?? "",
                matchupId: attributes["matchupId"] as? String ?? "",
                leagueId: attributes["leagueId"] as? String ?? ""
            )

            let state = parseMatchupState(initialState)

            let activity = try Activity.request(
                attributes: attrs,
                content: .init(state: state, staleDate: nil),
                pushType: .token
            )

            let activityId = activity.id

            // Observe push token updates
            let task = Task {
                for await tokenData in activity.pushTokenUpdates {
                    let token = tokenData.map { String(format: "%02x", $0) }.joined()
                    self.sendTokenEvent(activityId: activityId, token: token)
                }
            }
            tokenTasks[activityId] = task

            // Get initial push token
            if let tokenData = activity.pushToken {
                let token = tokenData.map { String(format: "%02x", $0) }.joined()
                resolve(["activityId": activityId, "pushToken": token])
            } else {
                // Token may arrive async; return without it for now
                resolve(["activityId": activityId, "pushToken": NSNull()])
            }
        } catch {
            reject("START_FAILED", error.localizedDescription, error)
        }
    }

    // MARK: - End Activity

    @objc func endActivity(
        _ activityId: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.1, *) else {
            reject("UNSUPPORTED", "Live Activities require iOS 16.1+", nil)
            return
        }

        Task {
            // Try matchup activities
            for activity in Activity<MatchupAttributes>.activities {
                if activity.id == activityId {
                    await activity.end(nil, dismissalPolicy: .immediate)
                    tokenTasks[activityId]?.cancel()
                    tokenTasks.removeValue(forKey: activityId)
                    resolve(true)
                    return
                }
            }

            // Try auction draft activities
            for activity in Activity<AuctionDraftAttributes>.activities {
                if activity.id == activityId {
                    await activity.end(nil, dismissalPolicy: .immediate)
                    tokenTasks[activityId]?.cancel()
                    tokenTasks.removeValue(forKey: activityId)
                    resolve(true)
                    return
                }
            }

            resolve(false)
        }
    }

    // MARK: - End All Activities

    @objc func endAllActivities(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.1, *) else {
            reject("UNSUPPORTED", "Live Activities require iOS 16.1+", nil)
            return
        }

        Task {
            for activity in Activity<MatchupAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            for activity in Activity<AuctionDraftAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            for (_, task) in tokenTasks {
                task.cancel()
            }
            tokenTasks.removeAll()
            resolve(true)
        }
    }

    // MARK: - Get Active Activities

    @objc func getActiveActivities(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.1, *) else {
            resolve([])
            return
        }

        var result: [[String: Any]] = []

        for activity in Activity<MatchupAttributes>.activities {
            var entry: [String: Any] = [
                "activityId": activity.id,
                "type": "matchup",
            ]
            if let tokenData = activity.pushToken {
                entry["pushToken"] = tokenData.map { String(format: "%02x", $0) }.joined()
            }
            result.append(entry)
        }

        for activity in Activity<AuctionDraftAttributes>.activities {
            var entry: [String: Any] = [
                "activityId": activity.id,
                "type": "auction_draft",
            ]
            if let tokenData = activity.pushToken {
                entry["pushToken"] = tokenData.map { String(format: "%02x", $0) }.joined()
            }
            result.append(entry)
        }

        resolve(result)
    }

    // MARK: - Helpers

    private func parseMatchupState(_ dict: NSDictionary) -> MatchupAttributes.ContentState {
        let playersArray = dict["players"] as? [[String: Any]] ?? []
        let players = playersArray.map { p in
            PlayerLine(
                name: p["name"] as? String ?? "",
                statLine: p["statLine"] as? String ?? "",
                fantasyPoints: p["fantasyPoints"] as? Double ?? 0,
                gameStatus: p["gameStatus"] as? String ?? "",
                isOnCourt: p["isOnCourt"] as? Bool ?? false
            )
        }

        return MatchupAttributes.ContentState(
            myScore: dict["myScore"] as? Double ?? 0,
            opponentScore: dict["opponentScore"] as? Double ?? 0,
            scoreGap: dict["scoreGap"] as? Double ?? 0,
            winProbability: dict["winProbability"] as? Double,
            biggestContributor: dict["biggestContributor"] as? String ?? "",
            myActivePlayers: dict["myActivePlayers"] as? Int ?? 0,
            opponentActivePlayers: dict["opponentActivePlayers"] as? Int ?? 0,
            players: players
        )
    }

    /// Send a push token update event to JS via NotificationCenter.
    /// The useLiveActivity hook listens for these to upsert tokens.
    private func sendTokenEvent(activityId: String, token: String) {
        NotificationCenter.default.post(
            name: NSNotification.Name("LiveActivityTokenUpdate"),
            object: nil,
            userInfo: ["activityId": activityId, "pushToken": token]
        )
    }
}
