package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** The Connections page's sign-in checks (docs/connections-ui.md): a pin saved with the definition, problems for the top bar. */
public class CredentialSignInTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static Map<String, Object> req(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) {
            m.put((String) kv[i], kv[i + 1]);
        }
        return m;
    }

    @Test
    @SuppressWarnings("unchecked")
    public void thePinIsTheProjectsAndAnUnreachableVaultIsAProblem() throws Exception {
        Path etc = tmp.newFolder("etc").toPath();
        Path defs = etc.resolve("environments.properties");
        Files.writeString(defs, "");
        Path mine = tmp.newFolder("users", "alice").toPath().resolve("environments.properties");
        CredentialService alice = new CredentialService(tmp.newFolder("tree").toPath(), EnvFiles.split(defs, mine));

        // a deployer defines the vault with its pinned certificate; the pin lives in the definition, not the person's file
        alice.save(req("name", "lab", "url", "ldaps://127.0.0.1:1", "driverSet", "cn=driverset1,o=system", "tier", "dev",
            "certSha256", "AB:CD:EF"));
        assertTrue(Files.readString(defs).contains("lab.certSha256=AB:CD:EF"));
        alice.saveMine(req("name", "lab", "bindDn", "cn=admin,o=system", "passwordStore", "file", "password", "pw"));
        assertFalse(Files.readString(mine).contains("certSha256"));
        Map<String, Object> listed = (Map<String, Object>) ((List<Object>) alice.list().get("environments")).get(0);
        assertEquals("AB:CD:EF", listed.get("certSha256"));

        // nothing listens on port 1: unreachable, and the top bar hears of it
        Map<String, Object> check = alice.check("lab", true);
        assertEquals(check.toString(), "unreachable", check.get("state"));
        List<Map<String, Object>> problems = (List<Map<String, Object>>) alice.problems().get("problems");
        assertEquals(1, problems.size());
        assertEquals("lab", problems.get(0).get("env"));

        // a vault nobody signed in to is not a problem, only "not signed in" on the list
        alice.save(req("name", "qa", "url", "ldaps://127.0.0.1:1", "driverSet", "cn=driverset1,o=system"));
        assertEquals(1, ((List<?>) alice.problems().get("problems")).size());

        Map<String, Object> cert = alice.certificate(req("url", "ldaps://127.0.0.1:1"));
        assertEquals(false, cert.get("ok"));
        try {
            alice.certificate(req("url", "ldap://127.0.0.1:389"));
            throw new AssertionError("an ldap:// address has no certificate");
        } catch (TreeService.BadRequest expected) {
            // refused
        }
    }
}
