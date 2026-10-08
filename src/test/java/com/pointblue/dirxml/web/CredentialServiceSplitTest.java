package com.pointblue.dirxml.web;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

/** Two files (docs/multi-user.md): the project's definitions, one person's credentials. */
public class CredentialServiceSplitTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    @SuppressWarnings("unchecked")
    private static Map<String, Object> env(Map<String, Object> list, String name) {
        for (Object o : (List<Object>) list.get("environments")) {
            Map<String, Object> e = (Map<String, Object>) o;
            if (name.equals(e.get("name"))) {
                return e;
            }
        }
        return null;
    }

    private static Map<String, Object> req(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) {
            m.put((String) kv[i], kv[i + 1]);
        }
        return m;
    }

    @Test
    public void aDefinitionIsListedForEveryoneAndConnectedOnlyWithOwnCredentials() throws Exception {
        Path etc = tmp.newFolder("etc").toPath();
        Path defs = etc.resolve("environments.properties");
        Files.writeString(defs, "edir3.url=ldaps://edir3:636\nedir3.driverSet=cn=driverset1,o=system\nedir3.tier=dev\n");
        Path mine = tmp.newFolder("users", "alice").toPath().resolve("environments.properties");
        CredentialService alice = new CredentialService(tmp.newFolder("tree").toPath(), EnvFiles.split(defs, mine));

        Map<String, Object> list = alice.list();
        assertEquals(true, list.get("split"));
        Map<String, Object> e = env(list, "edir3");
        assertEquals(true, e.get("defined"));
        assertEquals(false, e.get("own"));
        assertEquals(false, e.get("connected"));
        assertNull(e.get("bindDn"));
        assertEquals("the secrets file sits beside the definitions", etc.resolve("secrets-edir3.properties").toString(), e.get("secretsFile"));

        alice.saveMine(req("name", "edir3", "bindDn", "cn=alice,o=system", "trustAll", true, "passwordStore", "file", "password", "pw"));
        e = env(alice.list(), "edir3");
        assertEquals(true, e.get("connected"));
        assertEquals(true, e.get("ready"));
        assertEquals("cn=alice,o=system", e.get("bindDn"));
        assertEquals("literal", e.get("password"));
        String defsText = Files.readString(defs);
        assertFalse("nothing of the person's reaches the definitions", defsText.contains("alice") || defsText.contains("password"));
        assertTrue(Files.readString(mine).contains("edir3.bindDn=cn=alice,o=system"));

        alice.removeMine("edir3");
        assertEquals(false, env(alice.list(), "edir3").get("connected"));
        assertTrue("the definition stays", Files.readString(defs).contains("edir3.url="));
    }

    @Test
    public void theDefinitionTakesNoPasswordAndAnOwnEnvironmentTakesEverything() throws Exception {
        Path defs = tmp.newFolder("etc").toPath().resolve("environments.properties");
        Files.writeString(defs, "edir3.url=ldaps://edir3:636\nedir3.driverSet=cn=ds,o=system\n");
        Path mine = tmp.newFolder("users", "bob").toPath().resolve("environments.properties");
        CredentialService bob = new CredentialService(tmp.newFolder("tree").toPath(), EnvFiles.split(defs, mine));
        try {
            bob.save(req("name", "edir3", "url", "ldaps://x:636", "passwordStore", "file", "password", "pw"));
            fail("a password went into the definitions");
        } catch (TreeService.BadRequest expected) {
            assertTrue(expected.getMessage().contains("own connection"));
        }
        bob.save(req("name", "edir3", "tier", "stg", "bindDn", "cn=ignored,o=x"));
        String defsText = Files.readString(defs);
        assertTrue(defsText.contains("edir3.tier=stg"));
        assertFalse("bindDn is a person's, never a definition's", defsText.contains("bindDn"));

        bob.save(req("name", "edir3", "eventsUrl", "db:5432/idmEvent", "eventsUser", "reader", "eventsPseudonymise", true));
        assertTrue("the event store's location is a definition", Files.readString(defs).contains("edir3.eventsUrl=db:5432/idmEvent"));
        bob.saveMine(req("name", "edir3", "bindDn", "cn=bob,o=x", "passwordStore", "file", "password", "pw", "eventsPasswordStore", "env:EV_PW"));
        Map<String, Object> e3 = env(bob.list(), "edir3");
        assertEquals("env", e3.get("eventsPassword"));
        assertEquals("db:5432/idmEvent", e3.get("eventsUrl"));
        assertTrue(Files.readString(mine).contains("edir3.eventsPasswordEnv=EV_PW"));
        assertFalse("the event store's password is the person's", Files.readString(defs).contains("eventsPassword"));

        bob.saveMine(req("name", "lab", "url", "ldaps://mine:636", "driverSet", "cn=ds,o=mine", "bindDn", "cn=bob,o=mine", "passwordStore", "env:LAB_PW"));
        Map<String, Object> e = env(bob.list(), "lab");
        assertEquals(true, e.get("own"));
        assertEquals("ldaps://mine:636", e.get("url"));
        assertEquals("env", e.get("password"));
        assertFalse("an own environment never reaches the definitions", Files.readString(defs).contains("lab."));
    }

    @Test
    public void oneFileBehavesAsBefore() throws Exception {
        Path f = tmp.newFolder("one").toPath().resolve("environments.properties");
        CredentialService one = new CredentialService(tmp.newFolder("tree").toPath(), EnvFiles.single(f));
        one.save(req("name", "dev", "url", "ldaps://dev:636", "bindDn", "cn=admin,o=system", "driverSet", "cn=ds,o=system", "passwordStore", "file", "password", "pw"));
        Map<String, Object> list = one.list();
        assertEquals(false, list.get("split"));
        Map<String, Object> e = env(list, "dev");
        assertEquals(true, e.get("ready"));
        assertNull(e.get("defined"));
        try {
            one.saveMine(req("name", "dev"));
            fail("mine on one file");
        } catch (TreeService.BadRequest expected) {
            // one file: the environment form does it all
        }
    }
}
