const UnitT    = require('./UnitT.js'),
    UnitClassT = require('./UnitClassT.js'),
    UnitPredT  = require('./UnitPredT.js')


module.exports = class CompositeT {
    constructor(specs, options={}) {
        this.options = {
            prefix:     options.prefix || '$',
            serializer: options.serializer || JSON
        }
        if (!(specs instanceof Array)) throw new Error('Expected array of specs')
        this.unitTs  = specs.map(this.makeUnitT)
        this.predTs  = this.unitTs.filter((s) => s instanceof UnitPredT)
        this.classTs = this.unitTs.filter((s) => s instanceof UnitClassT)
        let err = this.validateConsistency(this.unitTs)
        if (err) throw new Error(`Inconsistent transformers: ${err}`)
    }


    dump(val) { return this._dump(val) }


    _dump(val, mutate=false) {
        let isObject = val && typeof val == 'object',
            isPlain  = isObject && (!val.constructor || val.constructor === Object)
        for (let i in this.predTs) {
            let predT = this.predTs[i]
            if (predT.pred(val)) {
                let dumped = predT.dump(val)
                return { [this.options.prefix + predT.path]: this._dump(dumped, true) }
            }
        }
        if (isObject && !isPlain) {
            for (let i in this.classTs) {
                if (val.constructor !== this.classTs[i].class) continue
                let classT = this.classTs[i],
                    dumped = classT.dump(val)
                return { [this.options.prefix + classT.path]: this._dump(dumped, true) }
            }
        }
        if (val instanceof Array) {
            if (mutate) {
                for (let i in val) val[i] = this._dump(val[i])
                return val
            } else {
                return val.map((child) => this._dump(child))
            }
        } else if (isPlain) {
            if (mutate) {
                for (let key in val) {
                    if (val.hasOwnProperty(key)) val[key] = this._dump(val[key])
                }
                return val
            } else {
                let copy = {}
                for (let key in val) {
                    if (val.hasOwnProperty(key)) copy[key] = this._dump(val[key])
                }
                return copy
            }
        }
        return val
    }


    restore(val) { return this._restore(this._cloneStructure(val)) }


    restoreUnsafe(val) { return this._restore(val) }


    _cloneStructure(val) {
        if (val instanceof Array) {
            return val.map((child) => this._cloneStructure(child))
        } else if (val && typeof val == 'object') {
            let copy = {}
            for (let key in val) {
                if (val.hasOwnProperty(key)) copy[key] = this._cloneStructure(val[key])
            }
            return copy
        } else {
            return val
        }
    }


    _restore(val) {
        if (val instanceof Array) {
            for (let i in val) val[i] = this._restore(val[i])
            return val
        }
        if (val instanceof Object) {
            let keys = Object.keys(val)
            if (keys.length === 1 && keys[0].startsWith(this.options.prefix)) {
                let key = keys[0],
                    path = key.slice(this.options.prefix.length)
                for (let i in this.unitTs) {
                    let trans = this.unitTs[i]
                    if (trans.path === path) {
                        let restoredChildren = this._restore(val[key])
                        return trans.restore(restoredChildren)
                    }
                }
            }
            for (let i in val) val[i] = this._restore(val[i])
            return val
        }
        return val
    }


    extendWith(specs, options) {
        if (!(specs instanceof Array)) return this.extendWith([specs], options)
        let result = []
        this.unitTs.concat(specs).forEach((spec) => {
            if (spec instanceof CompositeT) {
                spec.unitTs.forEach((unitT) => result.push(unitT))
            } else {
                result.push(spec)
            }
        })
        return new CompositeT(result, options || this.options)
    }


    overrideBy(specs, options) {
        if (!(specs instanceof Array)) return this.overrideBy([specs], options)
        let result = []
        this.unitTs.concat(specs).reverse().forEach((spec) => {
            if (spec instanceof CompositeT) {
                spec.unitTs.reverse().forEach((unitT) => {
                    result.unshift(unitT)
                    if (this.validateConsistency(result)) result.shift()
                })
                options = spec.options
            } else {
                result.unshift(spec)
                if (this.validateConsistency(result)) result.shift()
            }
        })
        return new CompositeT(result, options || this.options)
    }


    withOptions(opts={}) {
        return new CompositeT(this.unitTs, {
            prefix:     opts.prefix     || this.options.prefix,
            serializer: opts.serializer || this.options.serializer
        })
    }


    makeUnitT(spec) {
        switch (true) {
            case spec instanceof UnitT: return spec
            case spec && !!spec.class:  return new UnitClassT(spec)
            case spec && !!spec.pred:   return new UnitPredT(spec)
            default: throw new Error('Invalid spec, no class or predicate')
        }
    }


    validateConsistency(unitTs) {
        for (let i in unitTs) {
            let trans     = unitTs[i],
                token     = trans.token,
                ns        = trans.namespace,
                sameNs    = unitTs.filter((s) => s.namespace === ns),
                sameToken = sameNs.filter((s) => s.token === token)
            if (sameToken.length > 1)  return `${sameToken.length} transformers for token ${token}`
            if (trans instanceof UnitClassT) {
                let sameClass = unitTs.filter((t) => t.class === trans.class)
                if (sameClass.length > 1) return `${sameClass.length} transformers for class ${trans.class.name}`
            }
        }
    }
}