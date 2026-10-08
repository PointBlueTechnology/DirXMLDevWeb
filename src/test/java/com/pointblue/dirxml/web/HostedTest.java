package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** The hosted configuration, roles, sessions and the security seams. */
public class HostedTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private Hosted hosted(String extra) throws Exception {
        Path f = tmp.newFolder().toPath().resolve("hosted.properties");
        Files.writeString(f, "public.url=https://idm.example.com/\nrepo.url=https://github.com/org/idm.git\nroles.editor=idm-editors,idm-deployers\nroles.deployer=idm-deployers\n" + extra);
        return Hosted.load(f);
    }

    @Test
    public void rolesComeFromGroups() throws Exception {
        Hosted h = hosted("");
        Session.Principal editor = h.principal("a", "A", null, List.of("idm-editors"));
        Session.Principal deployer = h.principal("b", "B", null, List.of("idm-deployers", "other"));
        Session.Principal nobody = h.principal("c", "C", null, List.of("other"));
        assertTrue(editor.editor && !editor.deployer);
        assertTrue(deployer.editor && deployer.deployer);
        assertFalse(nobody.editor || nobody.deployer);
        assertTrue(hosted("roles.editor=*\n").principal("d", "D", null, List.of()).editor);
    }

    @Test
    public void aProjectNamesItsOwnEnvironments() throws Exception {
        Hosted h = hosted("projects=lab,other\nproject.lab.repo.url=https://github.com/org/lab.git\nproject.lab.environments=edir3, edir3-prd\nproject.other.repo.url=https://github.com/org/other.git\n");
        assertEquals(List.of("edir3", "edir3-prd"), h.projects.get("lab").environments);
        assertEquals(List.of(), h.projects.get("other").environments);
        assertEquals(List.of("a"), hosted("repo.environments=a\n").projects.values().iterator().next().environments);
    }

    @Test
    public void theNoneProviderParsesItsUsersAndIsLoopbackOnly() throws Exception {
        Hosted h = hosted("identity=none\nnone.users=alice:Alice:alice@x:idm-editors|qa;bob:Bob\n");
        List<Session.Principal> users = h.noneUsers();
        assertEquals(2, users.size());
        assertEquals("alice@x", users.get(0).email);
        assertEquals(List.of("idm-editors", "qa"), users.get(0).groups);
        assertTrue(users.get(0).editor);
        assertFalse(users.get(1).editor);
        new NoneIdentity(h);
        try {
            new NoneIdentity(hosted("identity=none\nbind=0.0.0.0\nnone.users=a:A\n"));
            throw new AssertionError("accepted a non-loopback bind");
        } catch (IllegalArgumentException expected) {
            assertTrue(expected.getMessage().contains("loopback"));
        }
    }

    @Test
    public void theTokenProviderNeedsALongEnoughSecretAndGivesEveryRole() throws Exception {
        try {
            new TokenIdentity(hosted("identity=token\ntoken.value=short\n"));
            throw new AssertionError("accepted a short token");
        } catch (IllegalArgumentException expected) {
            assertTrue(expected.getMessage().contains("16"));
        }
        TokenIdentity t = new TokenIdentity(hosted("identity=token\ntoken.value=0123456789abcdefXYZ\ntoken.user=jerry\n"));
        assertEquals("token", t.name());
    }

    @Test
    public void hostedSecurityChecksThePublicHostAndOriginOnly() {
        Security s = Security.hosted("https://idm.example.com");
        assertNull(s.refuse("idm.example.com", null, null));
        assertNull(s.refuse("IDM.example.com", "https://idm.example.com", null));
        assertTrue(s.refuse("evil.example", null, null).contains("answers only"));
        assertTrue(s.refuse("idm.example.com", "https://evil.example", null).contains("origin"));
        assertTrue(s.hostedMode());
        assertFalse(new Security("t", 1).hostedMode());
    }

    @Test
    public void sessionsExpireAndKnowTheirWorkspace() throws Exception {
        Session.Store store = new Session.Store(0);
        Session s = store.create(Session.Principal.local());
        assertNull("a zero-second session is gone at once", store.get(s.id));
        Session.Store longer = new Session.Store(3600);
        Session t = longer.create(Session.Principal.local());
        t.workspace = "w";
        assertEquals("w", longer.get(t.id).workspace);
        assertEquals(48, t.csrf.length());
        longer.remove(t.id);
        assertNull(longer.get(t.id));
    }

    @Test
    public void aPersistentStoreSurvivesARestartAndRemembersTheLastBranch() throws Exception {
        Path dir = Files.createTempDirectory("idmweb-sessions");
        Path f = dir.resolve("sessions.json");
        Session.Store store = Session.Store.persistent(3600, f);
        Session.Principal alice = new Session.Principal("alice", "Alice", "alice@x", List.of("idm-editors"), true, false);
        Session s = store.create(alice);
        store.opened(s, "lab/alice/feature_x", "lab", "feature/x");
        assertTrue(Files.exists(f));
        assertEquals("rw-------", java.nio.file.attribute.PosixFilePermissions.toString(Files.getPosixFilePermissions(f)));
        // a new server: the session is back, with its workspace and csrf, and the person's last branch is known
        Session.Store again = Session.Store.persistent(3600, f);
        Session back = again.get(s.id);
        assertEquals("alice", back.principal.subject);
        assertTrue(back.principal.editor);
        assertEquals(s.csrf, back.csrf);
        assertEquals("lab/alice/feature_x", back.workspace);
        assertEquals("feature/x", again.lastOf("alice").branch);
        assertEquals("lab", again.lastOf("alice").project);
        // an expired one is dropped on load, the last branch is not
        Session.Store expired = Session.Store.persistent(0, f);
        assertNull(expired.get(s.id));
        assertEquals("lab", expired.lastOf("alice").project);
        // never expires
        assertTrue(Session.Store.NEVER > 3600L * 24 * 365 * 10);
    }

    @Test
    public void theCompareLinkKnowsGitHubAndGitLab() {
        assertEquals("https://github.com/org/idm/compare/main...feature/x?expand=1", Git.compareUrl("https://github.com/org/idm.git", "main", "feature/x"));
        assertEquals("https://github.com/org/idm/compare/main...f?expand=1", Git.compareUrl("git@github.com:org/idm.git", "main", "f"));
        assertTrue(Git.compareUrl("https://gitlab.example.com/g/idm.git", "main", "f").contains("merge_requests/new"));
        assertNull(Git.compareUrl("/srv/repo.git", "main", "f"));
        assertNull(Git.compareUrl("https://github.com/org/idm.git", "main", "main"));
        assertEquals("/", Auth.safeNext("//evil"));
        assertEquals("/x", Auth.safeNext("/x"));
        assertEquals("/", Auth.safeNext("https://evil"));
    }
}
