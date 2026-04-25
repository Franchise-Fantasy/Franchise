import { useQuery } from "@tanstack/react-query";
import { PurchasesPackage } from "react-native-purchases";

import { queryKeys } from "@/constants/queryKeys";
import { getOfferings } from "@/lib/purchases";

interface GroupedOfferings {
  /** All packages in the current offering */
  packages: PurchasesPackage[];
  /** Pro monthly package */
  proMonthly: PurchasesPackage | null;
  /** Pro annual package */
  proAnnual: PurchasesPackage | null;
  /** Premium monthly package */
  premiumMonthly: PurchasesPackage | null;
  /** Premium annual package */
  premiumAnnual: PurchasesPackage | null;
  /** League Pro monthly */
  leagueProMonthly: PurchasesPackage | null;
  /** League Pro annual */
  leagueProAnnual: PurchasesPackage | null;
  /** League Premium monthly */
  leaguePremiumMonthly: PurchasesPackage | null;
  /** League Premium annual */
  leaguePremiumAnnual: PurchasesPackage | null;
}

function findPkg(
  packages: PurchasesPackage[],
  id: string,
): PurchasesPackage | null {
  return packages.find((p) => p.identifier === id) ?? null;
}

export function useOfferings() {
  return useQuery<GroupedOfferings | null>({
    queryKey: queryKeys.rcOfferings(),
    queryFn: async () => {
      const offering = await getOfferings();
      if (!offering) return null;

      const pkgs = offering.availablePackages;
      return {
        packages: pkgs,
        proMonthly: findPkg(pkgs, "pro_monthly"),
        proAnnual: findPkg(pkgs, "pro_annual"),
        premiumMonthly: findPkg(pkgs, "premium_monthly"),
        premiumAnnual: findPkg(pkgs, "premium_annual"),
        leagueProMonthly: findPkg(pkgs, "league_pro_monthly"),
        leagueProAnnual: findPkg(pkgs, "league_pro_annual"),
        leaguePremiumMonthly: findPkg(pkgs, "league_premium_monthly"),
        leaguePremiumAnnual: findPkg(pkgs, "league_premium_annual"),
      };
    },
    staleTime: 1000 * 60 * 30, // offerings rarely change
  });
}
