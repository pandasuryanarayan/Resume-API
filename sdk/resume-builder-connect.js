/*!
 * Resume Builder Connect v1.0.0
 * A dependency-free browser connector for the Resume Builder API.
 *
 *   const rb = ResumeBuilderConnect.init({ baseUrl: 'https://api.example.com' });
 *   await rb.downloadPDF({ fullName: 'Asha Rao', email: 'asha@example.com' });
 *   rb.mount('#resume-widget', { template: 'modern' });
 *
 * MIT licensed. No cookies, no tracking, no build step.
 */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  function Connector(options) {
    var opts = options || {};
    this.baseUrl = String(opts.baseUrl || '').replace(/\/+$/, '');
    this.apiKey = opts.apiKey || null;
    this.template = opts.template || 'classic';
    this.timeoutMs = opts.timeoutMs || 30000;
  }

  Connector.prototype._headers = function (extra) {
    var headers = Object.assign({}, extra || {});
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;
    return headers;
  };

  Connector.prototype._url = function (path, query) {
    var url = this.baseUrl + path;
    var pairs = [];
    Object.keys(query || {}).forEach(function (key) {
      if (query[key] !== undefined && query[key] !== null && query[key] !== '') {
        pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(query[key]));
      }
    });
    return pairs.length ? url + '?' + pairs.join('&') : url;
  };

  Connector.prototype._fetch = function (path, init, query) {
    var self = this;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller
      ? setTimeout(function () {
          controller.abort();
        }, this.timeoutMs)
      : null;

    var options = Object.assign({}, init || {});
    if (controller) options.signal = controller.signal;

    return fetch(this._url(path, query), options)
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res.ok) {
          return res
            .json()
            .catch(function () {
              return {};
            })
            .then(function (body) {
              var error = new Error(
                (body && body.error && body.error.message) || 'Request failed with status ' + res.status
              );
              error.status = res.status;
              error.code = body && body.error && body.error.code;
              error.details = body && body.error && body.error.details;
              error.requestId = body && body.request_id;
              throw error;
            });
        }
        return res;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        if (err && err.name === 'AbortError') {
          throw new Error('Request timed out after ' + self.timeoutMs + 'ms');
        }
        throw err;
      });
  };

  /** List the templates the API can render. */
  Connector.prototype.templates = function () {
    return this._fetch('/v1/templates').then(function (res) {
      return res.json().then(function (body) {
        return body.templates;
      });
    });
  };

  /** Normalise + validate a payload without rendering it. */
  Connector.prototype.validate = function (data) {
    return this._fetch('/v1/validate', {
      method: 'POST',
      headers: this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data || {}),
    }).then(function (res) {
      return res.json();
    });
  };

  /** HTML preview as a string. Pass { full: true } for a standalone document. */
  Connector.prototype.previewHTML = function (data, options) {
    var opts = options || {};
    return this._fetch(
      '/v1/resumes/preview',
      {
        method: 'POST',
        headers: this._headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(data || {}),
      },
      { template: opts.template || this.template, full: opts.full ? '1' : undefined }
    )
      .then(function (res) {
        return res.text();
      })
      .then(function (text) {
        if (opts.full) return text;
        try {
          return JSON.parse(text).html;
        } catch (err) {
          return text;
        }
      });
  };

  /** Render the PDF and hand back a Blob. */
  Connector.prototype.generatePDF = function (data, options) {
    var opts = options || {};
    return this._fetch(
      '/v1/resumes/pdf',
      {
        method: 'POST',
        headers: this._headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(data || {}),
      },
      { template: opts.template || this.template }
    ).then(function (res) {
      return res.blob();
    });
  };

  /** Render the PDF and save it to the visitor's machine. */
  Connector.prototype.downloadPDF = function (data, options) {
    var opts = options || {};
    var name = opts.filename || String((data && data.fullName) || 'Resume').replace(/\s+/g, '_') + '_Resume.pdf';
    return this.generatePDF(data, opts).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
      return { blob: blob, filename: name };
    });
  };

  /**
   * Mount a ready-made form that collects the essentials and downloads the PDF.
   * Styling is inline so the widget drops into any site without a stylesheet.
   */
  Connector.prototype.mount = function (target, options) {
    var self = this;
    var opts = options || {};
    var root = typeof target === 'string' ? document.querySelector(target) : target;
    if (!root) throw new Error('ResumeBuilderConnect.mount: target not found');

    var accent = opts.accent || '#16a34a';
    var FIELDS = [
      { key: 'fullName', label: 'Full name', required: true, type: 'text', placeholder: 'Asha Rao' },
      { key: 'email', label: 'Email', required: true, type: 'email', placeholder: 'asha@example.com' },
      { key: 'phone', label: 'Phone', type: 'tel', placeholder: '9876543210' },
      { key: 'address', label: 'Address', type: 'text', placeholder: 'Pune, Maharashtra' },
      { key: 'summary', label: 'Career objective', type: 'textarea', placeholder: 'One or two lines about you' },
      { key: 'skills', label: 'Skills', type: 'text', placeholder: 'Python, SQL, Airflow' },
      { key: 'workExperience', label: 'Experience', type: 'textarea', placeholder: '- Role at Company (2022-Present): what you did' },
    ];

    var form = document.createElement('form');
    form.setAttribute('novalidate', 'novalidate');
    form.style.cssText = 'display:grid;gap:12px;font-family:inherit;text-align:left;';

    FIELDS.forEach(function (field) {
      var wrap = document.createElement('label');
      wrap.style.cssText = 'display:block;font-size:13px;font-weight:600;color:#334155;';
      wrap.textContent = field.label + (field.required ? ' *' : '');

      var input = document.createElement(field.type === 'textarea' ? 'textarea' : 'input');
      if (field.type !== 'textarea') input.type = field.type;
      else input.rows = 3;
      input.name = field.key;
      input.placeholder = field.placeholder || '';
      input.required = Boolean(field.required);
      input.style.cssText =
        'display:block;width:100%;margin-top:4px;padding:9px 11px;font:inherit;font-size:14px;font-weight:400;' +
        'border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;box-sizing:border-box;';

      wrap.appendChild(input);
      form.appendChild(wrap);
    });

    var templateRow = document.createElement('label');
    templateRow.style.cssText = 'display:block;font-size:13px;font-weight:600;color:#334155;';
    templateRow.textContent = 'Template';
    var select = document.createElement('select');
    select.name = 'template';
    select.style.cssText =
      'display:block;width:100%;margin-top:4px;padding:9px 11px;font:inherit;font-size:14px;font-weight:400;' +
      'border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;box-sizing:border-box;';
    templateRow.appendChild(select);
    form.appendChild(templateRow);

    var button = document.createElement('button');
    button.type = 'submit';
    button.textContent = opts.buttonLabel || 'Download resume as PDF';
    button.style.cssText =
      'margin-top:6px;padding:11px 18px;font:inherit;font-size:15px;font-weight:700;color:#fff;' +
      'background:' + accent + ';border:none;border-radius:9px;cursor:pointer;';
    form.appendChild(button);

    var status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.style.cssText = 'font-size:13px;color:#64748b;min-height:18px;';
    form.appendChild(status);

    var note = document.createElement('div');
    note.style.cssText = 'font-size:11.5px;color:#94a3b8;';
    note.textContent = 'Powered by Resume Builder API';
    form.appendChild(note);

    function setStatus(text, isError) {
      status.textContent = text;
      status.style.color = isError ? '#b91c1c' : '#15803d';
    }

    this.templates()
      .then(function (list) {
        list.forEach(function (tpl) {
          var option = document.createElement('option');
          option.value = tpl.id;
          option.textContent = tpl.name;
          select.appendChild(option);
        });
        select.value = opts.template || self.template;
      })
      .catch(function () {
        var option = document.createElement('option');
        option.value = opts.template || self.template;
        option.textContent = opts.template || self.template;
        select.appendChild(option);
      });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var data = {};
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.name || el.name === 'template') return;
        if (el.value && el.value.trim()) data[el.name] = el.value.trim();
      });

      if (!data.fullName || !data.email) {
        setStatus('Full name and email are required.', true);
        return;
      }

      button.disabled = true;
      setStatus('Building your resume…');
      self
        .downloadPDF(data, { template: select.value, filename: opts.filename })
        .then(function (result) {
          setStatus('Downloaded ' + result.filename);
          if (typeof opts.onSuccess === 'function') opts.onSuccess(result);
        })
        .catch(function (err) {
          setStatus(err.message || 'Could not generate the PDF.', true);
          if (typeof opts.onError === 'function') opts.onError(err);
        })
        .then(function () {
          button.disabled = false;
        });
    });

    root.innerHTML = '';
    root.appendChild(form);
    return this;
  };

  function init(options) {
    return new Connector(options);
  }

  global.ResumeBuilderConnect = { init: init, Connector: Connector, version: VERSION };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.ResumeBuilderConnect;
})(typeof window !== 'undefined' ? window : this);
