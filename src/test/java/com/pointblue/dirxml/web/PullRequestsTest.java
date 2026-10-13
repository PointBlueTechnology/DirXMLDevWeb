package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.pointblue.dirxml.dev.json.Json;
import com.sun.net.httpserver.HttpServer;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/** #35: where requests go for a remote, and what is sent to and read from GitHub and GitLab (a stub of each). */
public class PullRequestsTest {

    private HttpServer stub;
    private String base;
    private final List<String> seen = new ArrayList<>();
    private int status = 200;
    private String answer = "[]";

    @Before
    public void start() throws Exception {
        stub = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        stub.createContext("/", ex -> {
            String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            String auth = ex.getRequestHeaders().getFirst("Authorization");
            String priv = ex.getRequestHeaders().getFirst("PRIVATE-TOKEN");
            seen.add(ex.getRequestMethod() + " " + ex.getRequestURI().getRawPath()
                + (ex.getRequestURI().getRawQuery() == null ? "" : "?" + ex.getRequestURI().getRawQuery())
                + " auth=" + (auth != null ? auth : priv != null ? "PRIVATE-TOKEN " + priv : "none") + " body=" + body);
            byte[] out = answer.getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().set("Content-Type", "application/json");
            ex.sendResponseHeaders(status, out.length);
            try (OutputStream o = ex.getResponseBody()) {
                o.write(out);
            }
        });
        stub.start();
        base = "http://127.0.0.1:" + stub.getAddress().getPort();
    }

    @After
    public void stop() {
        stub.stop(0);
    }

    @Test
    public void aRemoteNamesItsProviderAndApi() {
        PullRequests.Target t = PullRequests.target("https://x-access-token:secret@github.com/PointBlue/idm-config.git", null, null);
        assertEquals(PullRequests.Provider.GITHUB, t.provider());
        assertEquals("https://api.github.com", t.apiUrl());
        assertEquals("PointBlue/idm-config", t.repoPath());
        assertEquals("PointBlue/idm-config", PullRequests.target("git@github.com:PointBlue/idm-config.git", null, null).repoPath());
        PullRequests.Target gl = PullRequests.target("ssh://git@gitlab.example.com:2222/ops/idm/config.git", null, null);
        assertEquals(PullRequests.Provider.GITLAB, gl.provider());
        assertEquals("https://gitlab.example.com/api/v4", gl.apiUrl());
        assertEquals("ops/idm/config", gl.repoPath());
        assertEquals("the host without its port: a person's token is kept by it", "gitlab.example.com", gl.host());
        PullRequests.Target ghe = PullRequests.target("https://git.example.com/team/config", "github", null);
        assertEquals("https://git.example.com/api/v3", ghe.apiUrl());
        assertEquals("https://api.example/v3", PullRequests.target("https://git.example.com/team/config", "GitHub", "https://api.example/v3/").apiUrl());
        assertNull("an unknown host without repo.provider", PullRequests.target("https://git.example.com/team/config", null, null));
        assertNull(PullRequests.target("/srv/git/config.git", null, null));
        try {
            PullRequests.target("https://git.example.com/a/b", "bitbucket", null);
            fail("accepted an unknown provider");
        } catch (IllegalArgumentException expected) {
            assertTrue(expected.getMessage().contains("github or gitlab"));
        }
    }

    @Test
    public void gitHubFindsTheBranchsOpenRequestAndCreatesOne() throws Exception {
        PullRequests p = new PullRequests(null);
        PullRequests.Target t = new PullRequests.Target(PullRequests.Provider.GITHUB, base, "PointBlue/idm-config", "github.com");
        answer = "[{\"number\":12,\"html_url\":\"https://github.com/PointBlue/idm-config/pull/12\",\"state\":\"open\",\"title\":\"T\",\"draft\":false}]";
        Map<String, Object> found = p.findOpen(t, "tok", "feature/x");
        assertEquals("GET /repos/PointBlue/idm-config/pulls?state=open&head=PointBlue%3Afeature%2Fx auth=Bearer tok body=", seen.get(0));
        assertEquals(12, ((Number) found.get("number")).intValue());
        assertEquals("https://github.com/PointBlue/idm-config/pull/12", found.get("url"));

        answer = "{\"number\":13,\"html_url\":\"https://github.com/PointBlue/idm-config/pull/13\",\"state\":\"open\",\"title\":\"Add\",\"draft\":true}";
        Map<String, Object> made = p.create(t, "tok", "main", "feature/x", "Add", "- one", true);
        assertTrue(seen.get(1), seen.get(1).startsWith("POST /repos/PointBlue/idm-config/pulls auth=Bearer tok"));
        Map<String, Object> sent = Json.asMap(Json.parse(seen.get(1).substring(seen.get(1).indexOf("body=") + 5)));
        assertEquals("feature/x", sent.get("head"));
        assertEquals("main", sent.get("base"));
        assertEquals(Boolean.TRUE, sent.get("draft"));
        assertEquals(13, ((Number) made.get("number")).intValue());
        assertEquals(Boolean.TRUE, made.get("draft"));
    }

    @Test
    public void gitLabUsesTheProjectPathAndADraftPrefix() throws Exception {
        PullRequests p = new PullRequests(null);
        PullRequests.Target t = new PullRequests.Target(PullRequests.Provider.GITLAB, base, "ops/idm/config", "gitlab.example.com");
        answer = "[]";
        assertNull(p.findOpen(t, "tok", "feature/x"));
        assertEquals("GET /projects/ops%2Fidm%2Fconfig/merge_requests?state=opened&source_branch=feature%2Fx auth=PRIVATE-TOKEN tok body=", seen.get(0));
        answer = "{\"iid\":7,\"web_url\":\"https://gitlab.example.com/ops/idm/config/-/merge_requests/7\",\"state\":\"opened\",\"title\":\"Draft: Add\",\"draft\":true}";
        Map<String, Object> made = p.create(t, "tok", "main", "feature/x", "Add", "body", true);
        Map<String, Object> sent = Json.asMap(Json.parse(seen.get(1).substring(seen.get(1).indexOf("body=") + 5)));
        assertEquals("Draft: Add", sent.get("title"));
        assertEquals("feature/x", sent.get("source_branch"));
        assertEquals("main", sent.get("target_branch"));
        assertEquals(7, ((Number) made.get("number")).intValue());
        assertEquals("opened", made.get("state"));
    }

    @Test
    public void theProvidersOwnWordsComeBack() throws Exception {
        PullRequests p = new PullRequests(null);
        status = 422;
        answer = "{\"message\":\"Validation Failed\",\"errors\":[{\"message\":\"A pull request already exists for PointBlue:feature/x.\"}]}";
        try {
            p.create(new PullRequests.Target(PullRequests.Provider.GITHUB, base, "PointBlue/idm-config", "github.com"), "tok", "main", "feature/x", "T", "", false);
            fail("no error");
        } catch (PullRequests.ProviderError e) {
            assertEquals("GitHub (422): Validation Failed; A pull request already exists for PointBlue:feature/x.", e.getMessage());
            assertEquals(422, e.status);
        }
        status = 409;
        answer = "{\"message\":[\"Another open merge request already exists for this source branch: !7\"]}";
        try {
            p.create(new PullRequests.Target(PullRequests.Provider.GITLAB, base, "ops/config", "gitlab.example.com"), "tok", "main", "feature/x", "T", "", false);
            fail("no error");
        } catch (PullRequests.ProviderError e) {
            assertEquals("GitLab (409): Another open merge request already exists for this source branch: !7", e.getMessage());
        }
    }
}
