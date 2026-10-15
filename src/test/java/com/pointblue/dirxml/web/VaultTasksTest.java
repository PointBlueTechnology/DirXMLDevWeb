package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import java.util.List;
import java.util.Map;
import org.junit.After;
import org.junit.Test;

/** Deploys and rollbacks as tasks: one at a time per environment, progress line by line, the result kept. */
public class VaultTasksTest {

    @After
    public void forget() {
        VaultTasks.clear();
    }

    @Test
    public void oneWriteAtATimePerEnvironment() {
        VaultTasks.Task t = VaultTasks.start("deploy", "PROD", "jerry", "PROD", "ad-runbook");
        assertNotNull(t);
        assertNull("a second deploy to the same environment does not start", VaultTasks.start("deploy", "prod", "alice", "PROD", "main"));
        assertNull("nor a rollback", VaultTasks.start("rollback", "PROD", "alice", "PROD", "main"));
        String busy = VaultTasks.busy("prod");
        assertTrue(busy, busy.startsWith("a deploy to PROD is running (started by jerry ") && busy.endsWith("wait for it to finish"));
        assertNotNull("another environment is free", VaultTasks.start("deploy", "QA", "alice", "PROD", "main"));

        VaultTasks.finish(t, Map.of("ok", true));
        assertNull(VaultTasks.busy("PROD"));
        assertNotNull(VaultTasks.start("deploy", "PROD", "alice", "PROD", "main"));
    }

    @Test
    public void progressAndTheResultAreKeptForThePageToFollow() {
        VaultTasks.Task t = VaultTasks.start("deploy", "lab", "me", "idm-lab", "main");
        t.line("reading the vault");
        t.line("write 1/2: modify cn=x");
        t.line(" ");
        Map<String, Object> running = t.json();
        assertEquals(true, running.get("running"));
        assertEquals(2, ((List<?>) running.get("lines")).size());
        assertNull(running.get("result"));

        VaultTasks.finish(t, Map.of("ok", true, "snapshot", "deploy-snapshots/lab/x.ldif"));
        t.line("after the end: ignored");
        Map<String, Object> done = t.json();
        assertEquals(false, done.get("running"));
        assertEquals(2, ((List<?>) done.get("lines")).size());
        assertEquals(true, ((Map<?, ?>) done.get("result")).get("ok"));
        assertNotNull(done.get("finishedAt"));

        assertSame(t, VaultTasks.get(t.id));
        assertSame(t, VaultTasks.latest("LAB"));
        assertFalse(VaultTasks.latest("lab").running());
        assertNull(VaultTasks.latest("other"));
    }
}
