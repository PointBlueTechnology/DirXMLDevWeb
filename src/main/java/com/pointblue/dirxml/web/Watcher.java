package com.pointblue.dirxml.web;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.util.List;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

/**
 * The tree's revision: a short hash over every file's path, size and modification time. It
 * changes when anything edits the tree — this server, the CLI, an agent, an editor, git — and
 * that is the signal the page reloads on and the value a write must quote to prove it was
 * planned against the tree as it is now. Polled, because the JDK's file watching on macOS is
 * itself a slow poll and a tree is a few hundred small files.
 */
public final class Watcher implements AutoCloseable {

    /** Directories that are not part of the tree's content. */
    static final Set<String> SKIP = Set.of(".git", "node_modules", ".dirxmldev", "deploy-snapshots");

    private final Path tree;
    private final long intervalMs;
    private final List<Consumer<String>> listeners = new CopyOnWriteArrayList<>();
    private volatile String revision;
    private volatile boolean running = true;
    private Thread thread;

    public Watcher(Path tree, long intervalMs) throws IOException {
        this.tree = tree;
        this.intervalMs = intervalMs;
        this.revision = signature(tree);
    }

    public String revision() {
        return revision;
    }

    public void onChange(Consumer<String> listener) {
        listeners.add(listener);
    }

    public void remove(Consumer<String> listener) {
        listeners.remove(listener);
    }

    /** Recompute now (after this server wrote), telling listeners when it moved. */
    public synchronized String refreshNow() {
        try {
            String now = signature(tree);
            if (!now.equals(revision)) {
                revision = now;
                for (Consumer<String> l : listeners) {
                    try {
                        l.accept(now);
                    } catch (RuntimeException e) {
                        // a listener that fails is a client that went away
                    }
                }
            }
        } catch (IOException e) {
            // the tree is mid-write; the next poll sees it settled
        }
        return revision;
    }

    public void start() {
        thread = new Thread(() -> {
            while (running) {
                try {
                    Thread.sleep(intervalMs);
                } catch (InterruptedException e) {
                    return;
                }
                refreshNow();
            }
        }, "tree-watcher");
        thread.setDaemon(true);
        thread.start();
    }

    @Override
    public void close() {
        running = false;
        if (thread != null) {
            thread.interrupt();
        }
    }

    /** The revision of a tree as it is on disk. */
    public static String signature(Path tree) throws IOException {
        TreeMap<String, String> entries = new TreeMap<>();
        Files.walkFileTree(tree, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                return !dir.equals(tree) && SKIP.contains(dir.getFileName().toString()) ? FileVisitResult.SKIP_SUBTREE : FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                if (attrs.isRegularFile() && !file.getFileName().toString().equals(".DS_Store")) {
                    entries.put(tree.relativize(file).toString().replace('\\', '/'), attrs.size() + "|" + attrs.lastModifiedTime().toMillis());
                }
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFileFailed(Path file, IOException e) {
                return FileVisitResult.CONTINUE;   // deleted between listing and reading
            }
        });
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            for (var e : entries.entrySet()) {
                md.update((e.getKey() + "|" + e.getValue() + "\n").getBytes(StandardCharsets.UTF_8));
            }
            StringBuilder sb = new StringBuilder();
            byte[] d = md.digest();
            for (int i = 0; i < 8; i++) {
                sb.append(String.format("%02x", d[i]));
            }
            return sb.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
