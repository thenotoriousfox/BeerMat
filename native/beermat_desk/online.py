"""BeerMat Online for the venue, through the quiz server (as the web desk's Venue tab): sign in or create the operator's
account, pick the venue, edit its details and regular quiz nights, publish or cancel quiz nights, register this laptop
(its shared results then count for the venue, and its plan comes with it), and open the subscription page. The quiz
server passes on only the calls that run a venue (onlineCalls in server/server.js); the password never stays."""
from PySide6.QtCore import Property, QObject, QUrl, Signal, Slot
from PySide6.QtGui import QDesktopServices

DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']


class OnlineVenue(QObject):
    changed = Signal()

    def __init__(self, desk):
        super().__init__(desk)
        self.desk, self.api = desk, desk.api
        self._account, self._venues, self._venue, self._chosen = {}, [], None, ''

    @Property('QVariantMap', notify=changed)
    def account(self):
        return self._account

    @Property('QVariantList', notify=changed)
    def venues(self):
        return self._venues

    @Property('QVariantMap', notify=changed)
    def venue(self):
        v = dict(self._venue or {})
        if v:
            nights = {n['day']: n.get('time', '20:00') for n in v.get('quizNights') or []}
            v['nights'] = [{'day': d, 'on': d in nights, 'time': nights.get(d, '20:00')} for d in DAYS]
            key = (self.desk._results or {}).get('venueKeyId')
            v['registered'] = bool(key and key in (v.get('keys') or []))
        return v

    def _fail(self, error):
        self.desk.toast.emit(error, True)

    def _call(self, method, path, body=None, done=None):
        self.api.host('online/call', {'method': method, 'path': path, **({'body': body} if body is not None else {})}, done or (lambda _: None), self._fail, timeout_ms=30000)

    @Slot()
    def load(self):
        if not self.api.session:
            return

        def account(a):
            self._account = a
            if not a.get('signedIn'):
                self._venues, self._venue = [], None
                self.changed.emit()
                return
            self._call('GET', '/v1/me/venues', None, venues)

        def venues(reply):
            self._venues = reply.get('venues') or []
            pick = next((v for v in self._venues if v['id'] == self._chosen), self._venues[0] if self._venues else None)
            if not pick:
                self._venue = None
                self.changed.emit()
                return
            self._call('GET', f'/v1/venues/{pick["id"]}', None, lambda detail: self._got_venue({**pick, **detail}))
        self.desk.loadResults()
        self.api.host('online/account', {}, account, self._fail)

    def _got_venue(self, venue):
        self._venue = venue
        self.changed.emit()

    @Slot(str)
    def choose(self, venue_id):
        self._chosen = venue_id
        self.load()

    @Slot(str, str)
    def signIn(self, email, password):
        self.api.host('online/signin', {'email': email, 'password': password},
                      lambda _: (self.desk.toast.emit('Signed in to BeerMat Online', False), self.load(), self.desk.refreshPlanQuietly()), self._fail, timeout_ms=30000)

    @Slot(str, str, str)
    def signUp(self, email, password, name):
        self.api.host('online/signup', {'email': email, 'password': password, 'displayName': name},
                      lambda _: (self.desk.toast.emit('Account created: BeerMat links it to your venue', False), self.load()), self._fail, timeout_ms=30000)

    @Slot()
    def signOut(self):
        self.api.host('online/signout', {}, lambda _: (self.desk.toast.emit('Signed out', False), self.load()), self._fail)

    @Slot('QVariantMap')
    def save(self, fields):
        """Name, town, postcode, address, website, lat/lon (or none), and the regular quiz nights."""
        if not self._venue:
            return
        lat, lon = str(fields.get('lat') or '').strip(), str(fields.get('lon') or '').strip()
        try:
            position = (float(lat), float(lon)) if lat and lon else (None, None) if not lat and not lon else None
        except ValueError:
            position = None
        if position is None:
            return self._fail('Give both latitude and longitude as numbers, or neither')
        body = {k: str(fields.get(k) or '').strip() for k in ('name', 'town', 'postcode', 'address', 'website')}
        body.update(lat=position[0], lon=position[1],
                    quizNights=[{'day': n['day'], 'time': n.get('time') or '20:00'} for n in fields.get('nights') or [] if n.get('on')])
        self._call('PATCH', f'/v1/venues/{self._venue["id"]}', body, lambda _: (self.desk.toast.emit('Venue saved', False), self.load()))

    @Slot(str)
    def locate(self, postcode):
        def found(at):
            self._venue = {**(self._venue or {}), 'lat': at.get('lat'), 'lon': at.get('lon')}
            self.changed.emit()
            self.desk.toast.emit('Found: save the venue to keep it', False)
        self.api.host('online/locate', {'postcode': postcode}, found, self._fail, timeout_ms=20000)

    @Slot()
    def register(self):
        """Registers this laptop's key with the venue, then fetches the plan that comes with it."""
        if self._venue:
            self._call('POST', f'/v1/venues/{self._venue["id"]}/keys', None,
                       lambda _: (self.desk.toast.emit('This laptop is registered', False), self.load(), self.desk.refreshPlanQuietly()))

    @Slot(str, float, str, str, str)
    def publish(self, title, starts_at, entry, fmt, details):
        if self._venue:
            self._call('POST', f'/v1/venues/{self._venue["id"]}/events', {'title': title, 'startsAt': int(starts_at), 'entry': entry, 'format': fmt, 'details': details},
                       lambda _: (self.desk.toast.emit('Quiz night published', False), self.load()))

    @Slot(str)
    def cancel(self, event_id):
        self._call('DELETE', f'/v1/events/{event_id}', None, lambda _: (self.desk.toast.emit('Quiz night cancelled', False), self.load()))

    @Slot()
    def billing(self):
        """The venue's subscription is managed on Stripe's own page, in the browser."""
        if self._venue:
            self._call('POST', f'/v1/venues/{self._venue["id"]}/billing', None, lambda reply: reply.get('url') and QDesktopServices.openUrl(QUrl(reply['url'])))
