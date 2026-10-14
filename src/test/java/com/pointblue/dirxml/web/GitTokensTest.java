package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;
import java.util.Map;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** #35 P2: a person's own provider tokens, by host, kept as every credential here is, and never given back. */
public class GitTokensTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    @Test
    public void aTokenIsKeptByHostAndResolvedOnlyForThatHost() throws Exception {
        Path f = tmp.getRoot().toPath().resolve("git.properties");
        GitTokens t = new GitTokens(f);
        assertNull(t.resolve("github.com"));
        assertNull(t.store("github.com"));
        t.save("GitHub.com", "file", "ghp_secret");
        assertEquals("ghp_secret", t.resolve("github.com"));
        assertEquals("file", t.store("github.com"));
        assertNull("another host has none", t.resolve("gitlab.example.com"));
        assertEquals("rw-------", PosixFilePermissions.toString(Files.getPosixFilePermissions(f)));

        t.save("github.com", "command:printf other", null);
        assertEquals("command", t.store("github.com"));
        assertEquals("a new form replaces the old one", "other", t.resolve("github.com"));
        assertFalse(Files.readString(f).contains("ghp_secret"));

        t.save("gitlab.example.com", "env:IDMWEB_TEST_UNSET_TOKEN_VAR", null);
        assertEquals("env:IDMWEB_TEST_UNSET_TOKEN_VAR", t.store("gitlab.example.com"));

        assertTrue(t.remove("github.com"));
        assertNull(t.store("github.com"));
        assertFalse(t.remove("github.com"));
    }

    @Test
    public void badInputIsRefused() throws Exception {
        GitTokens t = new GitTokens(tmp.getRoot().toPath().resolve("git.properties"));
        for (String[] bad : new String[][] {{"github.com", "file", ""}, {"github.com", "keychain", "x"}, {"github.com", "env:", null}, {"../x", "file", "y"}, {"a b", "file", "y"}}) {
            try {
                t.save(bad[0], bad[1], bad[2]);
                fail("accepted " + String.join("|", java.util.Arrays.asList(bad)));
            } catch (TreeService.BadRequest expected) {
                // refused
            }
        }
    }

    @Test
    public void hostsAreTheProjectsProvidersWithWhetherAPersonHasATokenForEach() throws Exception {
        GitTokens t = new GitTokens(tmp.getRoot().toPath().resolve("git.properties"));
        Project a = new Project("a", "https://github.com/org/a.git", null, ".", "cases", "main", null, null);
        Project b = new Project("b", "git@github.com:org/b.git", null, ".", "cases", "main", null, null);
        Project c = new Project("c", "https://gitlab.example.com/ops/c.git", null, ".", "cases", "main", null, null);
        Project d = new Project("d", "/srv/git/d.git", null, ".", "cases", "main", null, null);
        t.save("gitlab.example.com", "file", "glpat");
        List<Map<String, Object>> hosts = t.hosts(List.of(a, b, c, d));
        assertEquals(2, hosts.size());
        assertEquals("github.com", hosts.get(0).get("host"));
        assertEquals(List.of("a", "b"), hosts.get(0).get("projects"));
        assertEquals(Boolean.FALSE, hosts.get(0).get("set"));
        assertEquals("GitLab", hosts.get(1).get("provider"));
        assertEquals(Boolean.TRUE, hosts.get(1).get("set"));
        assertEquals("file", hosts.get(1).get("store"));
        assertFalse("never the value", hosts.toString().contains("glpat"));
    }

    @Test
    public void aNonDeployersReferenceTokenIsRefusedAndNeverResolved() throws Exception {
        Path f = tmp.getRoot().toPath().resolve("git.properties");
        Path marker = tmp.getRoot().toPath().resolve("ran");
        GitTokens editor = new GitTokens(f, false);
        try {
            editor.save("github.com", "command:touch " + marker + "; echo t", null);
            fail("an editor saved a command reference");
        } catch (Api.Forbidden expected) {
            assertTrue(expected.getMessage().contains("only a deployer"));
        }
        try {
            editor.save("gitlab.example.com", "env:PATH", null);
            fail("an editor saved an environment variable reference");
        } catch (Api.Forbidden expected) {
            assertTrue(expected.getMessage().contains("only a deployer"));
        }
        editor.save("gitlab.example.com", "file", "glpat-x");   // a value in their own file stays open
        Files.writeString(f, "github.com.tokenCommand=touch " + marker + "; echo t\nbitbucket.example.com.tokenEnv=PATH\n",
            java.nio.charset.StandardCharsets.UTF_8, java.nio.file.StandardOpenOption.APPEND);
        try {
            editor.resolve("bitbucket.example.com");
            fail("read the server's variable");
        } catch (java.io.IOException expected) {
            assertTrue(expected.getMessage(), expected.getMessage().contains("read from an environment variable, which only a deployer"));
        }
        assertEquals("glpat-x", editor.resolve("gitlab.example.com"));
        try {
            editor.resolve("github.com");
            fail("resolved a refused command");
        } catch (java.io.IOException expected) {
            assertTrue(expected.getMessage().contains("only a deployer"));
        }
        Project p = new Project("a", "https://github.com/org/a.git", null, ".", "cases", "main", null, null);
        Map<String, Object> h = editor.hosts(List.of(p)).get(0);
        assertEquals(Boolean.TRUE, h.get("refused"));
        assertEquals(Boolean.FALSE, h.get("set"));
        assertFalse("the command never ran", Files.exists(marker));
        assertEquals("a deployer's runs", "t", new GitTokens(f, true).resolve("github.com"));
    }
}
