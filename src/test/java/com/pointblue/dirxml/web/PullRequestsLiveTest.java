package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.util.Map;
import org.junit.Assume;
import org.junit.Test;

/**
 * #35 against a real provider, skipped unless asked for: {@code -Dlive.pr.remote=<remote url>
 * -Dlive.pr.branch=<pushed scratch branch> -Dlive.pr.base=main}, the token in {@code LIVE_PR_TOKEN}. It creates a
 * draft request; close it and delete the branch afterwards.
 */
public class PullRequestsLiveTest {

    @Test
    public void findCreateFindOnTheRealProvider() throws Exception {
        String remote = System.getProperty("live.pr.remote");
        String token = System.getenv("LIVE_PR_TOKEN");
        Assume.assumeTrue(remote != null && token != null);
        String branch = System.getProperty("live.pr.branch");
        String base = System.getProperty("live.pr.base", "main");
        PullRequests p = new PullRequests(null);
        PullRequests.Target t = PullRequests.target(remote, null, null);
        assertNull("no open request on the scratch branch yet", p.findOpen(t, token, branch));
        Map<String, Object> made = p.create(t, token, base, branch, "Scratch: live check of #35 (to be closed)",
            "Created by PullRequestsLiveTest; closed right after.", true);
        System.out.println("LIVE created " + made.get("number") + " " + made.get("url") + " draft=" + made.get("draft"));
        Map<String, Object> found = p.findOpen(t, token, branch);
        assertEquals(made.get("number"), found.get("number"));
        assertEquals(Boolean.TRUE, found.get("draft"));
    }
}
