package com.pointblue.dirxml.web;

import com.sun.net.httpserver.HttpExchange;
import java.io.IOException;

/**
 * How a person signs in to the hosted server. {@code /auth/login} starts it, {@code /auth/callback}
 * finishes it (the OIDC code exchange; the {@code none} provider's user pick), and a session is
 * made for the principal. {@code /auth/logout} ends the session.
 */
public interface Identity {

    /** The provider's name for the page. */
    String name();

    /** Begin a sign-in: respond with a redirect or a page. {@code next} is where to go afterwards. */
    void login(HttpExchange ex, String next) throws IOException;

    /** Finish a sign-in from the provider's callback; the principal, or null (then the exchange was already answered). */
    Session.Principal callback(HttpExchange ex) throws IOException;
}
