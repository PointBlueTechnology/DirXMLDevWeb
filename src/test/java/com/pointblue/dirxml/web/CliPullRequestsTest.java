package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;
import java.util.Map;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** #35 P3: what a local install asks gh and glab, and what it reads back (stub CLIs that log their arguments). */
public class CliPullRequestsTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private Path dir;
    private CliPullRequests cli;

    /** A stub CLI: logs each call; answers auth from a marker file, the user, the list from state.json, create by writing it. */
    private Path stub(String name, String user, String createdJson, String url) throws Exception {
        Path p = dir.resolve(name);
        Files.writeString(p, "#!/bin/sh\n"
            + "D=$(dirname \"$0\")\n"
            + "printf '%s\\n' \"$*\" >> \"$D/" + name + ".log\"\n"
            + "case \"$1 $2\" in\n"
            + "  'auth status') [ -f \"$D/" + name + ".signed-out\" ] && { echo 'not logged in' >&2; exit 1; }; exit 0 ;;\n"
            + "  'api --hostname') echo '" + user + "' ; exit 0 ;;\n"
            + "  'pr list'|'mr list') [ -f \"$D/" + name + ".state\" ] && cat \"$D/" + name + ".state\" || echo '[]'; exit 0 ;;\n"
            + "  'pr create'|'mr create') [ -f \"$D/" + name + ".refuse\" ] && { echo 'a pull request for branch \"x\" into branch \"main\" already exists' >&2; exit 1; }; echo '" + createdJson + "' > \"$D/" + name + ".state\"; echo 'Creating...'; echo '" + url + "'; exit 0 ;;\n"
            + "esac\n"
            + "echo \"unexpected: $*\" >&2; exit 2\n");
        Files.setPosixFilePermissions(p, PosixFilePermissions.fromString("rwxr-xr-x"));
        return p;
    }

    @Before
    public void stubs() throws Exception {
        dir = tmp.newFolder("bin").toPath();
        Path gh = stub("gh", "jdoe", "[{\"number\":7,\"url\":\"https://github.com/org/repo/pull/7\",\"state\":\"OPEN\",\"title\":\"Add\",\"isDraft\":true}]", "https://github.com/org/repo/pull/7");
        Path glab = stub("glab", "{\"username\":\"gl-user\"}", "[{\"iid\":3,\"web_url\":\"https://gitlab.example.com/ops/repo/-/merge_requests/3\",\"state\":\"opened\",\"title\":\"Add\",\"draft\":false}]", "https://gitlab.example.com/ops/repo/-/merge_requests/3");
        cli = new CliPullRequests(gh.toString(), glab.toString());
    }

    private List<String> log(String name) throws Exception {
        Path l = dir.resolve(name + ".log");
        return Files.exists(l) ? Files.readAllLines(l) : List.of();
    }

    @Test
    public void gitHubThroughGh() throws Exception {
        PullRequests.Target t = PullRequests.target("git@github.com:org/repo.git", null, null);
        assertEquals("jdoe", cli.account(t, dir));
        assertNull(cli.findOpen(t, dir, "feature/x"));
        Map<String, Object> made = cli.create(t, dir, "main", "feature/x", "Add", "- one\n- two", true);
        assertEquals(7, ((Number) made.get("number")).intValue());
        assertEquals("open", made.get("state"));
        assertEquals(Boolean.TRUE, made.get("draft"));
        List<String> calls = log("gh");
        assertEquals("auth status --hostname github.com", calls.get(0));
        assertEquals("api --hostname github.com user --jq .login", calls.get(1));
        assertEquals("pr list --head feature/x --state open --json number,url,state,title,isDraft --limit 1", calls.get(2));
        assertTrue(calls.get(3), calls.get(3).startsWith("pr create --base main --head feature/x --title Add --body - one"));
        assertTrue("a draft asks for one", String.join("\n", calls).contains("--draft"));
    }

    @Test
    public void gitLabThroughGlab() throws Exception {
        PullRequests.Target t = PullRequests.target("https://gitlab.example.com/ops/repo.git", null, null);
        assertEquals("gl-user", cli.account(t, dir));
        Map<String, Object> made = cli.create(t, dir, "main", "feature/x", "Add", "body", false);
        assertEquals(3, ((Number) made.get("number")).intValue());
        assertEquals("https://gitlab.example.com/ops/repo/-/merge_requests/3", made.get("url"));
        List<String> calls = log("glab");
        assertTrue(String.join("\n", calls), calls.contains("mr create --source-branch feature/x --target-branch main --title Add --description body --yes"));
        assertTrue(calls.contains("mr list --source-branch feature/x --output json"));
    }

    @Test
    public void signedOutOrMissingIsNoAccount() throws Exception {
        PullRequests.Target t = PullRequests.target("https://github.com/org/repo", null, null);
        Files.writeString(dir.resolve("gh.signed-out"), "");
        assertNull(cli.account(t, dir));
        assertNull("no gh at all", new CliPullRequests(null, null).account(t, dir));
    }

    @Test
    public void theClisOwnWordsComeBack() throws Exception {
        PullRequests.Target t = PullRequests.target("https://github.com/org/repo", null, null);
        Files.writeString(dir.resolve("gh.refuse"), "");
        try {
            cli.create(t, dir, "main", "x", "T", "", false);
            fail("no error");
        } catch (PullRequests.ProviderError e) {
            assertEquals("gh: a pull request for branch \"x\" into branch \"main\" already exists", e.getMessage());
        }
    }
}
