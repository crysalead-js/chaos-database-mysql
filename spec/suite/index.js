import co from 'co';
import { Schema } from 'chaos-database';
import MySql from '../../src';
import { Dialect } from 'sql-dialect';

Promise = require('bluebird');

function getConnection() {
  return new MySql({
    database: 'chaos_test',
    username: 'root'
  });
}

describe("MySql", function() {

  before(function() {
    this.connection = getConnection();
  });

  describe(".constructor()", function() {

    it("allows to inject a dialect instance", function() {

      var dialect = new Dialect();
      var connection = new MySql({ dialect: dialect });

      expect(connection.dialect()).toBe(dialect);

    });

    it("correctly sets up a default dialect instance.", function() {

      var dialect = this.connection.dialect();

      expect(dialect.quote('tablename')).toBe("'tablename'");

      expect(dialect.value('string_value', {
        name: 'string_field',
        type: function(name) {
          if (name === 'string_field') {
            return 'string';
          }
        }
      })).toBe("'string_value'");

    });

  });

  describe(".enabled()", function() {

    it("returns `true` for enabled features, false otherwise.", function() {

      expect(MySql.enabled()).toEqual({
        arrays: false,
        transactions: true,
        booleans: true,
        default: false
      });
      expect(MySql.enabled('arrays')).toBe(false);
      expect(MySql.enabled('transactions')).toBe(true);
      expect(MySql.enabled('booleans')).toBe(true);
      expect(MySql.enabled('default')).toBe(false);

    });

  });

  describe(".connect()", function() {

    it("fails when it can't connect", function(done) {

      var connection = new MySql({
        host: 'hostlocal',
        database: 'chaos_test',
        username: 'root',
        password: 'root'
      });
      connection.connect().then(function() {
        expect(false).toBe(true);
      }).catch(function(err) {
        expect(err.message).toMatch(/Unable to connect to host/);
        done();
      });

    });

    it("throws an exception if no database name is set", function(done) {

      new MySql().connect().then(function() {
        expect(false).toBe(true);
      }).catch(function(err) {
        expect(err.message).toMatch(/Error, no database name has been configured./);
        done();
      });

    });

    it("returns the same connection when called multiple times.", function(done) {

      co(function*() {
        var expected = yield this.connection.connect();

        var actual = yield this.connection.connect();
        expect(actual).toBe(expected);

        actual = yield this.connection.connect();
        expect(actual).toBe(expected);
      }.bind(this)).then(function() {
        done();
      });

    });

  });

  describe(".client()", function() {

    it("returns the connected client.", function(done) {

      co(function*() {
        var connection = new getConnection();
        expect(connection.client()).toBe(undefined);
        yield connection.connect();
        expect(connection.client()).toBeAn('object');
      }.bind(this)).then(function() {
        done();
      });

    });

  });

  describe(".connected()", function() {

    it("returns `true` when connected.", function(done) {

      co(function*() {
        yield this.connection.connect();
        expect(this.connection.connected()).toBe(true);
      }.bind(this)).then(function() {
        done();
      });

    });

    it("returns `false` when not connected.", function() {

      var connection = new MySql();
      expect(connection.connected()).toBe(false);

    });

  });

  describe(".query()", function() {

    it("returns a cursor instance on success", function(done) {

      co(function*() {
        var response = yield this.connection.query("SELECT 1 + 1 as sum");
        var row = response.next();
        expect(row.sum).toBe(2);
        done();
      }.bind(this));

    });

    it("returns `true` on success when no data are available", function(done) {

      co(function*() {
        var schema = new Schema({ connection: this.connection });
        schema.source('gallery');
        schema.set('id', { type: 'serial' });
        schema.set('name', { type: 'string' });
        yield schema.create();

        expect(yield schema.insert({ name: 'new gallery' })).toBe(true);
        var id = schema.lastInsertId();

        expect(yield schema.update({ name: 'updated gallery' }, { name: 'new gallery' })).toBe(true);

        var cursor = yield this.connection.query('SELECT `name` FROM `gallery` WHERE `id` = ' + id);
        var gallery = cursor.next();
        expect(gallery.name).toBe('updated gallery');

        expect(yield schema.delete({ id: id })).toBe(true);

        var cursor = yield this.connection.query('SELECT `name` FROM `gallery` WHERE `id` = ' + id);
        expect(cursor.valid()).toBe(false);

        yield schema.drop();
        done();
      }.bind(this));

    });

    it("rejects the promise when an error occurs.", function(done) {

      co(function*() {
        var response = yield this.connection.query("SELECT * FROM");
      }.bind(this)).then(function() {
        expect(false).toBe(true);
      }).catch(function(err) {
        expect(err.message).toMatch(/You have an error in your SQL syntax/);
        done();
      });

    });

  });

  describe(".sources()", function() {

    it("shows sources", function(done) {

      co(function*() {
        var schema = new Schema({ connection: this.connection });
        schema.source('gallery');
        schema.set('id', { type: 'serial' });
        yield schema.create();

        var sources = yield this.connection.sources();

        expect(sources).toEqual({
          gallery: 'gallery'
        });

        yield schema.drop();
      }.bind(this)).then(function() {
        done();
      });
    });

  });

  describe(".describe()", function() {

    beforeEach(function() {

      this.schema = new Schema();
      this.schema.source('gallery');
      this.schema.set('id', { type: 'serial' });
      this.schema.set('name', {
        type: 'string',
        length: 128,
        'default': 'Johnny Boy'
      });
      this.schema.set('active', {
        type: 'boolean',
        'default': true
      });
      this.schema.set('inactive', {
        type: 'boolean',
        'default': false
      });
      this.schema.set('money', {
        type: 'decimal',
        length: 10,
        precision: 2
      });
      this.schema.set('created', {
        type: 'datetime',
        use: 'timestamp',
        'default': { ':plain': 'CURRENT_TIMESTAMP' }
      });

    });

    it("describe a source", function(done) {

      co(function*() {
        this.schema.connection(this.connection);
        yield this.schema.create();

        var gallery = yield this.connection.describe('gallery');

        expect(gallery.field('id')).toEqual({
          use: 'int',
          type: 'integer',
          length: 11,
          null: false,
          'default': null,
          array: false
        });

        expect(gallery.field('name')).toEqual({
          use: 'varchar',
          type: 'string',
          length: 128,
          null: true,
          'default': 'Johnny Boy',
          array: false
        });

        expect(gallery.field('active')).toEqual({
          use: 'tinyint',
          type: 'boolean',
          length: 1,
          null: true,
          'default': true,
          array: false
        });

        expect(gallery.field('inactive')).toEqual({
          use: 'tinyint',
          type: 'boolean',
          length: 1,
          null: true,
          'default': false,
          array: false
        });

        expect(gallery.field('money')).toEqual({
          use: 'decimal',
          type: 'decimal',
          length: 10,
          precision: 2,
          null: true,
          'default': null,
          array: false
        });

        expect(gallery.field('created')).toEqual({
          use: 'timestamp',
          type: 'datetime',
          null: true,
          'default': null,
          array: false
        });

        yield this.schema.drop();
      }.bind(this)).then(function() {
        done();
      });

    });

    it("creates a schema instance without introspection", function(done) {

      co(function*() {

        var gallery = yield this.connection.describe('gallery', this.schema.fields());

        expect(gallery.field('id')).toEqual({
          type: 'serial',
          null: false,
          array: false
        });

        expect(gallery.field('name')).toEqual({
          type: 'string',
          length: 128,
          null: true,
          'default': 'Johnny Boy',
          array: false
        });

        expect(gallery.field('active')).toEqual({
          type: 'boolean',
          null: true,
          'default': true,
          array: false
        });

        expect(gallery.field('inactive')).toEqual({
          type: 'boolean',
          null: true,
          'default': false,
          array: false
        });

        expect(gallery.field('money')).toEqual({
          type: 'decimal',
          length: 10,
          precision: 2,
          null: true,
          array: false
        });

        expect(gallery.field('created')).toEqual({
          use: 'timestamp',
          type: 'datetime',
          null: true,
          array: false,
          'default': { ':plain': 'CURRENT_TIMESTAMP' }
        });
      }.bind(this)).then(function() {
        done();
      });

    });

  });

  describe(".lastInsertId()", function() {

    it("gets the encoding last insert ID", function(done) {

      co(function*() {
        var schema = new Schema({ connection: this.connection });
        schema.source('gallery');
        schema.set('id',   { type: 'serial' });
        schema.set('name', { type: 'string' });
        yield schema.create();

        yield schema.insert({ name: 'new gallery' });
        expect(schema.lastInsertId()).toBe(1);

        yield schema.drop();
      }.bind(this)).then(function() {
        done();
      });

    });

    it("gets the encoding last insert ID even with an empty record", function(done) {

      co(function*() {
        var schema = new Schema({ connection: this.connection });
        schema.source('gallery');
        schema.set('id',   { type: 'serial' });
        schema.set('name', { type: 'string' });
        yield schema.create();

        yield schema.insert({});
        expect(schema.lastInsertId()).toBe(1);

        yield schema.drop();
      }.bind(this)).then(function() {
        done();
      });

    });

  });

  describe(".disconnect()", function() {

    it("disconnects the client.", function(done) {

      co(function*() {
        var connection = getConnection();

        expect(connection.disconnect()).toBe(true);
        expect(connection.connected()).toBe(false);

        yield connection.connect();
        expect(connection.connected()).toBe(true);

        expect(connection.disconnect()).toBe(true);
        expect(connection.connected()).toBe(false);

      }.bind(this)).then(function() {
        done();
      });

    });

  });

});
