from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend


class EmailOrPhoneBackend(ModelBackend):
    """Authenticates by email OR phone number under the same "email" field.

    simplejwt's TokenObtainSerializer always submits the credential under the
    key named by User.USERNAME_FIELD ("email") and forwards it to
    authenticate() as a keyword argument of that same name -- so `username`
    below stays None and the value arrives via **kwargs instead. Patients
    registered by the front desk with no real email (a placeholder is
    generated to satisfy the unique/required email column) would otherwise
    have no working login at all; this lets them sign in with the phone
    number they gave at registration instead.
    """

    def authenticate(self, request, username=None, password=None, **kwargs):
        User = get_user_model()
        identifier = username if username is not None else kwargs.get(User.USERNAME_FIELD)
        if not identifier or not password:
            return None

        user = User.objects.filter(email__iexact=identifier).first()
        if user is None:
            # phone isn't unique (blank is allowed for every user), so only
            # trust it as a login key when it resolves to exactly one account.
            matches = list(User.objects.filter(phone=identifier))
            user = matches[0] if len(matches) == 1 else None

        if user is not None and user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
