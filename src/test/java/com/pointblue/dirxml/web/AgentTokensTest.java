package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** Personal agent tokens: made by a person, acting as them, kept as a hash, revocable, following their roles. */
public class AgentTokensTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static Session.Principal alice(boolean deployer) {
        return new Session.Principal("alice", "Alice", "alice@example.com", deployer ? List.of("idm-deployers") : List.of("idm-editors"), true, deployer);
    }

    @Test
    public void aTokenActsAsItsPersonAndIsKeptOnlyAsAHash() throws Exception {
        Path data = tmp.newFolder("data").toPath();
        AgentTokens t = new AgentTokens(new UserData(data), data, 365);
        Map<String, Object> made = t.create(alice(false), "claude-laptop", 30);
        String token = String.valueOf(made.get("token"));
        assertTrue(token.startsWith(AgentTokens.PREFIX));
        AgentTokens.Entry e = t.find(token);
        assertNotNull(e);
        assertEquals("alice", e.who().subject);
        assertEquals("claude-laptop", e.label());
        assertNull("not ours", t.find(AgentTokens.PREFIX + "nope"));
        assertNull("not a token at all", t.find("something-else"));

        String file = Files.readString(data.resolve("users/alice/" + AgentTokens.FILE), StandardCharsets.UTF_8);
        assertFalse("the token itself is never written", file.contains(token));
        assertTrue(file.contains(AgentTokens.hash(token)));

        // a restart reads them back
        AgentTokens again = new AgentTokens(new UserData(data), data, 365);
        assertEquals("alice", again.find(token).who().subject);

        // roles follow the person
        again.refresh(alice(true));
        assertTrue(again.find(token).who().deployer);

        // one label per person; a life within the server's limit
        try {
            again.create(alice(true), "claude-laptop", 30);
            throw new AssertionError("a second token of the same label was made");
        } catch (TreeService.BadRequest expected) {
            // refused
        }
        try {
            new AgentTokens(new UserData(data), data, 30).create(alice(true), "long", 90);
            throw new AssertionError("a token past the limit was made");
        } catch (TreeService.BadRequest expected) {
            // refused
        }

        String id = String.valueOf(made.get("id"));
        assertFalse("only its person revokes it", again.revoke(new Session.Principal("bob", "Bob", null, List.of(), true, true), id));
        assertTrue(again.revoke(alice(true), id));
        assertNull(again.find(token));
        assertFalse("the emptied file goes", Files.exists(data.resolve("users/alice/" + AgentTokens.FILE)));
    }
}
