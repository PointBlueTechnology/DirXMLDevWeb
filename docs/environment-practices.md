# Working across environments: practices that keep them comparable

Most of what makes two environments hard to compare comes from a few habits. This page lists the
practices that prevent it, each with the problem it avoids. The examples come from a real
customer's QA and production driver sets. Read side by side, they held 16 drivers in only one of the
two, 81 values that differed, 52 differences of letter case alone, and several hundred changes to
policies, filters and packages in between. The page assumes one repository per driver set, with
production as `main` ([git-workflow.md](git-workflow.md)).

The design behind the tools named here: [existing environments](https://github.com/PointBlueTechnology/DirXMLDev/blob/master/docs/existing-environments.md).

## Change things in one place

1. **Make every change in the repository, then deploy it.** A change made in Designer or iManager
   straight to a vault is invisible to everyone else until someone compares. If one is unavoidable (an
   outage at night), capture that environment's state right afterwards (*Capture current state* on the
   plan step) and merge it, the same day.
2. **Fix production on a branch, and take the fix to QA in the same change.** The customer's production
   had an extra rule vetoing every user event on one driver's subscriber channel, a stopgap that QA never
   got. Six months later nobody could say whether it was still needed. Deploy a hot fix to production
   from a branch, deploy the same commit to QA, then merge.
3. **Promote through QA.** Branch, deploy to QA, test, merge into `main`, deploy to production. Set
   *Deploy order* on production to QA, so production only takes what QA has had.

## Keep what differs out of the configuration

4. **Put every environment-specific value in a GCV, never in a policy.** Host names, URLs, containers,
   e-mail addresses and server names typed into policies made seven of the customer's differences
   impossible to carry as values. A GCV can be overridden per environment; a literal in a rule makes the
   two environments' policies differ forever.
5. **Record each environment's values as overrides.** The tree holds production's value; `overrides/QA.properties`
   holds QA's. The Environments tab records them from a comparison in one click.
6. **Keep secrets out of the tree.** Each environment has its own secrets file or Keychain entries; a
   driver's secret can be named by the tree's name or by that environment's.

## Name things the same everywhere

7. **Give a driver the same name in every environment.** If an existing one differs and renaming is
   impractical, record that environment's name (*Name there* on the driver's Environments section).
   New drivers get one name from the start.
8. **Keep DNs identical, letter case included.** eDirectory reads `OU=SERVICES` and `OU=services` as the
   same, but 52 of the customer's differences were nothing else; they hide the real ones. The comparison
   sets them aside, but consistent case avoids them.
9. **Map every environment's servers.** Server names are unique to a tree, so every environment but
   production maps production's servers to its own, several to one where it has fewer (*Vault →
   Environments*, step 2). When a new driver first reaches an environment with several servers, choose
   the one that runs it in the plan.

## Say what is meant to differ

10. **Mark what only some environments get, and whether it is for now or for good.** A driver built in QA
    and not yet promoted is *planned* for production; a test loopback is QA's own. The comparison then
    shows planned items as waiting for promotion and keeps the rest quiet. Review the planned list
    before each release.
11. **Keep test-only objects in QA marked.** The customer's QA held 350 role-based entitlement policies
    production didn't. Marked as QA's own, they stop looking like drift.
12. **Model the feeds between environments explicitly.** A production-to-QA data feed has a driver at
    each end. Mark each end as its environment's, or keep one tree driver per role with a name per
    environment; either way the remote tree's address is an override in each environment, so a feed
    never points at the wrong tree.
13. **Accept known differences consciously.** When a difference is intended and no value can carry it,
    accept it with a reason (*on purpose*), or park it (*later*), so comparisons show only new ones. A
    known difference that changes shows again. Review the list each quarter and keep it short.

## Keep the parts in step

14. **Upgrade packages in QA first, then promote the same versions.** Thirteen of the customer's drivers
    ran different package versions in the two environments, which makes every policy the package owns
    look different.
15. **Keep job definitions identical; let only schedules, enablement and trace differ**, as overrides.
    Production runs scheduled jobs that QA leaves unscheduled; that should be the only difference.

## Look regularly

16. **Compare the environments before every release**, not only the tree with one vault: *Vault →
    Environments*. A difference that wasn't there last time is the earliest sign of a change made outside
    the repository.
17. **Compare the tree with production after every deploy** (the deploy's own verify does this) and
    capture drift as soon as it appears.

## Taking on an existing system

The usual start is the opposite of all this: environments changed by hand for years. The order that
works:

1. Import production into `main`.
2. Connect each other environment and compare it with production (*Vault → Environments*). Work through
   the steps it shows: confirm or reject the likely renames, map the servers, say what only one of them
   holds (for now or for good), and record the values as overrides. Commit.
3. Work through the remaining differences by likely cause, driver by driver: bring an environment in line,
   promote its newer work through a branch, fix what's wrong (a literal that belongs in a GCV), or accept
   it as known.
4. From then on, follow the practices above, so that each comparison shows only what's new.
