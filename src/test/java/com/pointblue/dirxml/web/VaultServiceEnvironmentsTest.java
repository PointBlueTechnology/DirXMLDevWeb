package com.pointblue.dirxml.web;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.Assert.assertEquals;

/** What the environment pickers learn: defined by the project, connected by the person, or the person's own. */
public class VaultServiceEnvironmentsTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    @Test
    @SuppressWarnings("unchecked")
    public void aDefinedEnvironmentWithoutTheCredentialIsNotReadyButSaysWhy() throws Exception {
        Path defs = tmp.newFolder("etc").toPath().resolve("environments.properties");
        Files.writeString(defs, "stg.url=ldaps://stg:636\nstg.driverSet=cn=ds,o=system\nstg.tier=stg\nprd.url=ldaps://prd:636\nprd.driverSet=cn=ds,o=system\nprd.tier=prd\n");
        Path mine = tmp.newFolder("users", "alice").toPath().resolve("environments.properties");
        Files.writeString(mine, "stg.bindDn=cn=alice,o=system\nstg.password=pw\nlab.url=ldaps://lab:636\nlab.driverSet=cn=ds,o=lab\nlab.bindDn=cn=a,o=lab\nlab.password=p\n");
        VaultService vault = new VaultService(tmp.newFolder("tree").toPath(), EnvFiles.split(defs, mine));
        Map<String, Object> m = vault.environments();
        assertEquals(true, m.get("split"));
        List<Map<String, Object>> envs = (List<Map<String, Object>>) m.get("environments");
        assertEquals(List.of("lab", "prd", "stg"), envs.stream().map(e -> e.get("name")).toList());
        Map<String, Object> stg = envs.get(2);
        assertEquals(true, stg.get("ready"));
        assertEquals(true, stg.get("connected"));
        assertEquals(false, stg.get("own"));
        Map<String, Object> prd = envs.get(1);
        assertEquals(false, prd.get("ready"));
        assertEquals(true, prd.get("defined"));
        assertEquals(false, prd.get("connected"));
        Map<String, Object> lab = envs.get(0);
        assertEquals(true, lab.get("own"));
        assertEquals(true, lab.get("ready"));
    }
}
