package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.ascode.AsCodeReader;
import com.pointblue.dirxml.dev.deploy.AgentWriteGate;
import com.pointblue.dirxml.dev.deploy.Deployer;
import com.pointblue.dirxml.dev.deploy.Environments;
import com.pointblue.dirxml.dev.deploy.ModelDiff;
import com.pointblue.dirxml.dev.deploy.Overrides;
import com.pointblue.dirxml.dev.deploy.Vault;
import com.pointblue.dirxml.dev.deploy.VaultDiff;
import com.pointblue.dirxml.dev.json.Json;
import com.pointblue.dirxml.dev.model.DriverSet;
import com.pointblue.dirxml.dev.operate.LdapTrace;
import com.pointblue.dirxml.dev.operate.Operate;
import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * The vault side of the workbench: which environments exist, the tree compared with one, a deploy
 * planned and run, the drivers' state and control, a driver's live trace. Each call is the core's
 * own function (the ones behind {@code vault.diff}, {@code vault.deploy}, {@code driverset.status},
 * {@code driver.start|stop|restart}, {@code driver.trace tail --ldap}) with its own short-lived
 * connection, resolved from the same environments file and credential sources the CLI uses.
 *
 * <p>Nothing here returns a secret: an environment is described by name, tier and what is
 * configured, never by value. Every write to a vault needs {@code confirm} to be the
 * environment's name, the CLI's {@code --confirm <env>}: the person types it.
 */
public final class VaultService {

    private final Path tree;

    public VaultService(Path tree) {
        this.tree = tree.toAbsolutePath().normalize();
    }

    private static Environments.Environment env(String name) throws IOException {
        if (name == null || name.isBlank()) {
            throw new TreeService.BadRequest("no environment named");
        }
        try {
            return Environments.load().get(name);
        } catch (IOException e) {
            throw new TreeService.BadRequest(e.getMessage());
        }
    }

    /** The environments file's environments, described without their values; or why there are none. */
    public Map<String, Object> environments() {
        Map<String, Object> m = new LinkedHashMap<>();
        List<Object> list = new ArrayList<>();
        try {
            Environments envs = Environments.load();
            m.put("file", envs.file().toString());
            for (Environments.Described d : envs.describe()) {
                Map<String, Object> e = new LinkedHashMap<>();
                e.put("name", d.name);
                e.put("tier", d.tier);
                e.put("ready", d.urlPresent && d.bindDnPresent && d.passwordConfigured && d.driverSetPresent);
                e.put("hasOverrides", java.nio.file.Files.isRegularFile(tree.resolve(Overrides.DIR).resolve(d.name + Overrides.EXT)));
                list.add(e);
            }
            m.put("available", true);
        } catch (IOException e) {
            m.put("available", false);
            m.put("why", e.getMessage());
        }
        m.put("environments", list);
        return m;
    }

    /** The tree against the environment's vault: the changes a deploy would make, and the overrides it applied. */
    public Map<String, Object> diff(String envName, List<String> drivers) throws IOException {
        Environments.Environment e = env(envName);
        ModelDiff diff;
        try {
            diff = VaultDiff.of(tree, e, drivers);
        } catch (IllegalArgumentException ex) {
            throw new TreeService.BadRequest(ex.getMessage());
        }
        Map<String, Object> m = new LinkedHashMap<>(Json.asMap(Json.parse(diff.json())));
        m.put("environment", e.name);
        m.put("tier", e.tier.name().toLowerCase());
        m.put("text", diff.text());
        m.put("overrides", overridesNote(e.name));
        return m;
    }

    private String overridesNote(String envName) throws IOException {
        DriverSet copy = AsCodeReader.read(tree);   // a throwaway read: apply mutates the model
        return Overrides.apply(copy, envName).summary();
    }

    /** What a deploy would do, step by step, with nothing written. */
    public Map<String, Object> plan(String envName, List<String> drivers, boolean restart, String secretsMode) throws IOException {
        Deployer.Options o = options(envName, drivers, restart, secretsMode);
        o.dryRun = true;
        return result(new Deployer(o).run(), o.env);
    }

    /** Run the deploy. {@code confirm} must be the environment's name. */
    public Map<String, Object> deploy(String envName, List<String> drivers, boolean restart, String secretsMode, String confirm) throws IOException {
        Deployer.Options o = options(envName, drivers, restart, secretsMode);
        String refusal = gate(o.env.name, confirm);
        if (refusal != null) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("ok", false);
            m.put("refusal", refusal);
            m.put("environment", o.env.name);
            return m;
        }
        o.yes = true;
        o.confirm = confirm;
        return result(new Deployer(o).run(), o.env);
    }

    private Deployer.Options options(String envName, List<String> drivers, boolean restart, String secretsMode) throws IOException {
        Deployer.Options o = new Deployer.Options();
        o.tree = tree;
        o.env = env(envName);
        o.drivers = drivers;
        o.restart = restart;
        o.secretsMode = secretsMode == null || secretsMode.isBlank() ? "none" : secretsMode;
        return o;
    }

    private static Map<String, Object> result(Deployer.Result r, Environments.Environment e) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", r.ok);
        m.put("environment", e.name);
        m.put("tier", e.tier.name().toLowerCase());
        m.put("refusal", r.refusal);
        m.put("failure", r.failure);
        m.put("plan", r.planText);
        m.put("diff", r.diffText);
        m.put("done", r.done);
        m.put("skipped", r.skipped);
        m.put("restarted", r.restarted);
        m.put("secretsSet", r.secretsSet);
        m.put("snapshot", r.snapshot);
        m.put("verified", r.verified);
        m.put("verify", r.verifyText);
        m.put("text", r.text());
        return m;
    }

    /**
     * The rule for any write to a vault from the page: the caller names the environment again,
     * exactly as the CLI's {@code --confirm <env>}. The agent switch ({@code IDM_AGENT_ALLOW_WRITE})
     * is deliberately not honoured here: a person at the page confirms each write.
     */
    static String gate(String envName, String confirm) {
        if (AgentWriteGate.refusal(envName, true, confirm, null) == null) {
            return null;
        }
        return "refusing to write to '" + envName + "': confirm by giving the environment's name";
    }

    /** Every driver of the environment's driver set with its state and start option. */
    public Map<String, Object> status(String envName) throws IOException {
        Environments.Environment e = env(envName);
        try (Vault vault = Vault.connect(e.vaultConfig())) {
            Operate.Result r = Operate.driversetStatus(Operate.vaultEngine(vault), e);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("environment", e.name);
            m.put("ok", r.ok);
            m.put("drivers", Json.parse(r.json()));
            m.put("text", r.text());
            return m;
        }
    }

    /** Start, stop or restart a driver. {@code confirm} must be the environment's name. */
    public Map<String, Object> lifecycle(String envName, String driver, String action, String confirm) throws IOException {
        if (!List.of("start", "stop", "restart").contains(action)) {
            throw new TreeService.BadRequest("action is start, stop or restart");
        }
        if (driver == null || driver.isBlank()) {
            throw new TreeService.BadRequest("no driver named");
        }
        Environments.Environment e = env(envName);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("environment", e.name);
        m.put("driver", driver);
        m.put("action", action);
        String refusal = gate(e.name, confirm);
        if (refusal != null) {
            m.put("ok", false);
            m.put("text", refusal);
            return m;
        }
        try (Vault vault = Vault.connect(e.vaultConfig())) {
            Operate.Result r = Operate.lifecycle(Operate.vaultEngine(vault), e, driver, action, 60, true, confirm, tree);
            m.put("ok", r.ok);
            m.put("text", r.text());
            return m;
        }
    }

    /** A driver's trace lines over the environment's LDAPS connection, until the calling thread is interrupted. */
    public void trace(String envName, String driver, boolean engineToo, Consumer<String> sink) throws IOException, InterruptedException {
        if (driver == null || driver.isBlank()) {
            throw new TreeService.BadRequest("no driver named");
        }
        LdapTrace.stream(env(envName), driver, null, engineToo, 0, sink);
    }
}
