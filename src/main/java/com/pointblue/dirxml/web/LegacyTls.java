package com.pointblue.dirxml.web;

import java.security.Security;
import java.util.Arrays;
import java.util.stream.Collectors;

/**
 * Keeps static-RSA key exchange ({@code TLS_RSA_*}) available, on by default, before the JDK's TLS
 * stack initialises — the hosted server talks TLS to its identity provider before any vault, so
 * this must run first thing in {@code main}. eDirectory's LDAPS listener often offers only those
 * suites, and recent JDK builds disable them, which made a connection test fail with "simple bind
 * failed" although the credentials were right. Opt out with {@code -Didm.tls.legacy=false} or
 * {@code IDM_TLS_LEGACY=false}. The same rule as DirXMLDev's {@code deploy.LegacyTls}; this copy
 * goes when the server depends on a core that has it.
 */
final class LegacyTls {
    private LegacyTls() {
    }

    static boolean wanted() {
        String p = System.getProperty("idm.tls.legacy", System.getenv("IDM_TLS_LEGACY"));
        return p == null || !p.trim().equalsIgnoreCase("false");
    }

    static void enable() {
        if (!wanted()) {
            return;
        }
        String disabled = Security.getProperty("jdk.tls.disabledAlgorithms");
        if (disabled != null && disabled.contains("TLS_RSA_*")) {
            Security.setProperty("jdk.tls.disabledAlgorithms", Arrays.stream(disabled.split(","))
                .map(String::trim)
                .filter(a -> !a.isEmpty() && !a.equals("TLS_RSA_*"))
                .collect(Collectors.joining(", ")));
        }
    }
}
