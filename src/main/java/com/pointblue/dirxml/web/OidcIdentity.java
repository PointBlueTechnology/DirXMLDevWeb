package com.pointblue.dirxml.web;

import com.sun.net.httpserver.HttpExchange;
import java.io.IOException;

/** OpenID Connect sign-in: built in the next step; the hosted server refuses to start with it until then. */
public final class OidcIdentity implements Identity {

    public OidcIdentity(Hosted hosted) {
        throw new IllegalArgumentException("identity=oidc is not available yet in this build; use identity=none on loopback");
    }

    @Override
    public String name() {
        return "oidc";
    }

    @Override
    public void login(HttpExchange ex, String next) throws IOException {
        throw new IllegalStateException();
    }

    @Override
    public Session.Principal callback(HttpExchange ex) throws IOException {
        throw new IllegalStateException();
    }
}
