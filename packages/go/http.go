package p9s

import (
	"context"
	"net/http"
)

type userKey struct{}

// WithUserID returns a context that carries the id of the user.
func WithUserID(ctx context.Context, userID any) context.Context {
	return context.WithValue(ctx, userKey{}, userID)
}

// UserID is the id of the user of a context, or nil.
func UserID(ctx context.Context) any {
	return ctx.Value(userKey{})
}

// Middleware puts the id of the user of each request in its context, for UserID: userIDOf returns it, or nil for no
// user, who reads as no one.
func Middleware(userIDOf func(*http.Request) any) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(WithUserID(r.Context(), userIDOf(r))))
		})
	}
}
