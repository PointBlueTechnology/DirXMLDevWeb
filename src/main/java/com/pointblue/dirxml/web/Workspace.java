package com.pointblue.dirxml.web;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * One tree and the services over it. Local mode has exactly one, the directory on the command
 * line; hosted mode has one per user and branch, a checkout of the team's repository.
 */
public final class Workspace implements AutoCloseable {

    public final String id;
    public final String branch;      // null in local mode
    public final Path root;          // the checkout (hosted) or the tree itself (local)
    public final Path tree;
    public final Watcher watcher;
    public final TreeService service;
    public final VaultService vault;
    public final SimService sim;
    public final ProvisioningService prov;
    public final PackageService packages;
    public final CredentialService credentials;
    public final EventsService events;
    /** Recordings and uploaded trace files; under the data directory in hosted mode, under ~/.idm locally. */
    public TraceFiles traces;

    private Workspace(String id, String branch, Path root, Path tree, Path cases, Path catalog, EnvFiles files) throws IOException {
        this.id = id;
        this.branch = branch;
        this.root = root;
        this.tree = tree;
        if (!Files.isRegularFile(tree.resolve("driverset.xml"))) {
            throw new TreeService.BadRequest(tree + " is not an IDM-as-code tree (no driverset.xml)");
        }
        this.watcher = new Watcher(tree, 750);
        this.service = new TreeService(tree, watcher);
        this.packages = new PackageService(tree, catalog);
        service.catalog(packages.catalogArg());
        this.vault = new VaultService(tree, files);
        this.sim = new SimService(tree, SimService.locate(tree, cases));
        this.vault.setCasesDir(this.sim.casesDir());
        this.prov = new ProvisioningService(tree);
        this.credentials = new CredentialService(tree, files);
        this.events = new EventsService(tree, sim.casesDir(), files);
        this.traces = new TraceFiles(Path.of(System.getProperty("user.home"), ".idm", "traces", id.replaceAll("[^A-Za-z0-9._-]+", "-")));
        watcher.start();
    }

    public static Workspace open(String id, String branch, Path root, Path tree, Path cases, Path catalog, EnvFiles files) throws IOException {
        return new Workspace(id, branch, root.toAbsolutePath().normalize(), tree.toAbsolutePath().normalize(), cases, catalog, files);
    }

    @Override
    public void close() {
        watcher.close();
    }
}
