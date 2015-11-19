import co from 'co';
import mysql from 'mysql';
import { Schema } from 'chaos-database';
import MySql from '../../src';

Promise = require('bluebird');

describe("MySql", function() {

  before(function() {
    this.connection = new MySql({
      database: 'chaos_test',
      username: 'root',
      password: 'root'
    });
  });

  describe(".enabled()", function() {

    it("returns `true` for enabled features, false otherwise.", function() {

      expect(MySql.enabled()).toEqual({
        arrays: false,
        transactions: true,
        booleans: true
      });
      expect(MySql.enabled('arrays')).toBe(false);
      expect(MySql.enabled('transactions')).toBe(true);
      expect(MySql.enabled('booleans')).toBe(true);

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
        var expected = yield this.connection.driver();

        var actual = yield this.connection.connect();
        expect(actual).toBe(expected);

        actual = yield this.connection.connect();
        expect(actual).toBe(expected);
      }.bind(this)).then(function() {
        done();
      });

    });

  });

  describe(".driver()", function() {

    it("returns the connected driver.", function(done) {

      co(function*() {
        var driver = yield this.connection.driver();
        expect(driver).toBeAn('object');
      }.bind(this)).then(function() {
        done();
      });

    });

  });

  describe(".disconnect()", function() {

    it("disconnect the driver.", function(done) {

      co(function*() {
        var connection = new MySql({
          database: 'chaos_test',
          username: 'root',
          password: 'root'
        });

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

  describe(".connected()", function() {

    it("returns `true` when connected.", function() {

      expect(this.connection.connected()).toBe(true);

    });

    it("returns `false` when not connected.", function() {

      var connection = new MySql({
        database: 'chaos_test',
        username: 'root',
        password: 'root',
        connect: false
      });

      expect(connection.connected()).toBe(false);

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

    it("describe a source", function(done) {

      co(function*() {
        var schema = new Schema({ connection: this.connection });
        schema.source('gallery');
        schema.set('id', { type: 'serial' });
        schema.set('name', {
          type: 'string',
          length: 128,
          'default': 'Johnny Boy'
        });
        schema.set('active', {
          type: 'boolean',
          'default': true
        });
        schema.set('inactive', {
          type: 'boolean',
          'default': false
        });
        schema.set('money', {
          type: 'decimal',
          length: 10,
          precision: 2
        });
        schema.set('created', {
          type: 'datetime',
          use: 'timestamp',
          'default': { ':plain': 'CURRENT_TIMESTAMP' }
        });
        yield schema.create();

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

        yield schema.drop();
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

  });

});
