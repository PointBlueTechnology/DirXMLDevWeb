package com.pointblue.dirxml.web;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;

import static org.junit.Assert.assertEquals;

/** Directories under data.dir that no project claims are named at start-up, never removed. */
public class WorkspacesUnclaimedTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    @Test
    public void workspacesOfNoProjectAndOldTraceDirectoriesAreListed() throws Exception {
        Path data = tmp.newFolder("data").toPath();
        Files.createDirectories(data.resolve("workspaces/edir3/alice/main"));
        Files.createDirectories(data.resolve("workspaces/agent_claude"));
        Files.createDirectories(data.resolve("workspaces/gone"));
        Files.createDirectories(data.resolve("traces/edir3"));
        Files.createDirectories(data.resolve("users/alice/traces/edir3"));
        Files.writeString(data.resolve("workspaces/stray.txt"), "");
        List<String> out = Workspaces.unclaimed(data, Set.of("edir3"));
        assertEquals(List.of("workspaces/agent_claude", "workspaces/gone", "traces/edir3"), out);
        assertEquals(List.of(), Workspaces.unclaimed(tmp.newFolder("empty").toPath(), Set.of()));
    }
}
