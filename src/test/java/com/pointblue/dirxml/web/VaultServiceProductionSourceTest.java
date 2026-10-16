package com.pointblue.dirxml.web;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

/**
 * Production from the base branch only (docs/git-workflow.md), unless the environment says
 * {@code <env>.fromAnyBranch=true}: a project with one environment has nowhere else to try a change.
 */
public class VaultServiceProductionSourceTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static final String REFUSAL = "a production deploy comes from main; this is feature/x";

    private Object deploy(String extra, AtomicInteger asked) throws Exception {
        Path defs = tmp.newFolder().toPath().resolve("environments.properties");
        Files.writeString(defs, "prod.url=ldaps://127.0.0.1:1\nprod.driverSet=cn=ds,o=system\nprod.tier=prd\nprod.bindDn=cn=a,o=system\nprod.password=x\n" + extra);
        VaultService vault = new VaultService(tmp.newFolder().toPath(), EnvFiles.single(defs));
        vault.setProductionSource("main", () -> {
            asked.incrementAndGet();
            return REFUSAL;
        });
        try {
            Map<String, Object> r = vault.deploy("prod", List.of(), new VaultService.DeployChoices(), "prod", line -> { });
            return r.get("refusal");
        } catch (Exception e) {
            return e;   // past the source check: the empty tree or the closed port stops it
        }
    }

    @Test
    public void productionIsCheckedUnlessTheEnvironmentAllowsAnyBranch() throws Exception {
        AtomicInteger asked = new AtomicInteger();
        assertEquals(REFUSAL, deploy("", asked));
        assertEquals(1, asked.get());

        AtomicInteger notAsked = new AtomicInteger();
        assertNotEquals(REFUSAL, deploy("prod.fromAnyBranch=true\n", notAsked));
        assertEquals("the source check is skipped", 0, notAsked.get());
    }
}
