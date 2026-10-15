package com.pointblue.dirxml.web;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The deploys and rollbacks the server is running or has just run, for the whole server: their progress as
 * the core reports it ({@code Deployer.Options.progress}), their result, and who started them. One write at a
 * time per environment: while a deploy or rollback to an environment runs, another write to it is refused
 * ({@link #busy}). The page follows a task by polling, so leaving the view and coming back loses nothing.
 * In memory: a restart forgets them (the deploy log and the snapshots are the record).
 */
public final class VaultTasks {

    /** One line of progress: when, and what. */
    public record Line(long at, String text) {
    }

    public static final class Task {
        public final String id = UUID.randomUUID().toString();
        public final String kind;           // deploy | rollback
        public final String env;
        public final String user;
        public final String project;
        public final String branch;
        public final long startedAt = System.currentTimeMillis();
        private final List<Line> lines = new ArrayList<>();
        private volatile long finishedAt;
        private volatile Map<String, Object> result;

        Task(String kind, String env, String user, String project, String branch) {
            this.kind = kind;
            this.env = env;
            this.user = user;
            this.project = project;
            this.branch = branch;
        }

        public synchronized void line(String text) {
            if (finishedAt == 0 && text != null && !text.isBlank()) {
                lines.add(new Line(System.currentTimeMillis(), text));
            }
        }

        public boolean running() {
            return finishedAt == 0;
        }

        public Map<String, Object> result() {
            return result;
        }

        synchronized void finish(Map<String, Object> r) {
            result = r;
            finishedAt = System.currentTimeMillis();
        }

        public synchronized Map<String, Object> json() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", id);
            m.put("kind", kind);
            m.put("env", env);
            m.put("user", user);
            m.put("project", project);
            m.put("branch", branch);
            m.put("startedAt", startedAt);
            m.put("finishedAt", finishedAt == 0 ? null : finishedAt);
            m.put("running", running());
            List<Map<String, Object>> ls = new ArrayList<>();
            for (Line l : lines) {
                ls.add(Map.of("at", l.at(), "text", l.text()));
            }
            m.put("lines", ls);
            m.put("result", result);
            m.put("now", System.currentTimeMillis());
            return m;
        }
    }

    private static final int KEEP = 50;
    private static final Deque<Task> TASKS = new ArrayDeque<>();

    private VaultTasks() {
    }

    /**
     * A new task for {@code env}, or null when a deploy or rollback to it is already running ({@link #busy}
     * says which). The check and the registration are one step, so two deploys cannot both start.
     */
    public static synchronized Task start(String kind, String env, String user, String project, String branch) {
        if (running(env) != null) {
            return null;
        }
        Task t = new Task(kind, env, user, project, branch);
        TASKS.addFirst(t);
        while (TASKS.size() > KEEP) {
            TASKS.removeLast();
        }
        return t;
    }

    public static synchronized void finish(Task t, Map<String, Object> result) {
        t.finish(result);
    }

    /** The deploy or rollback running against {@code env}, or null. */
    public static synchronized Task running(String env) {
        for (Task t : TASKS) {
            if (t.running() && t.env.equalsIgnoreCase(env)) {
                return t;
            }
        }
        return null;
    }

    /** The most recent task for {@code env}, running or not, or null. */
    public static synchronized Task latest(String env) {
        for (Task t : TASKS) {
            if (t.env.equalsIgnoreCase(env)) {
                return t;
            }
        }
        return null;
    }

    public static synchronized Task get(String id) {
        for (Task t : TASKS) {
            if (t.id.equals(id)) {
                return t;
            }
        }
        return null;
    }

    /** Why a write to {@code env} has to wait, or null when nothing runs against it. */
    public static String busy(String env) {
        Task t = running(env);
        if (t == null) {
            return null;
        }
        long s = (System.currentTimeMillis() - t.startedAt) / 1000;
        return "a " + t.kind + " to " + t.env + " is running (started by " + t.user + " " + (s / 60) + ":" + String.format("%02d", s % 60)
            + " ago); wait for it to finish";
    }

    /** For tests: forget every task. */
    static synchronized void clear() {
        TASKS.clear();
    }
}
